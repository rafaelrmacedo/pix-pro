import express from "express";
import cors from "cors";
import pg from "pg";
import mqUtils from "../../shared/src/mq-utils.js";
import loggerShared from "../../shared/src/logger.js";
import redisUtils from "../../shared/src/redis-utils.js";
import { EVENT_TYPES } from "../../shared/src/events/event-types.js";
import BaseCommand from "../../shared/src/cqrs/base-command.js";
import { COMMAND_TYPES } from "../../shared/src/cqrs/command-types.js";
import RabbitMQEventBus from "../../shared/src/events/event-bus.js";
import { MQ_QUEUES } from "../../shared/src/mq-topology.js";
import { uploadToCDN, isConfigured as isCDNConfigured } from "./storage-utils.js";

const { Pool } = pg;
const { connectRedis } = redisUtils;
const { connectMQ, publishEvent, publishCommand, assertQueueWithDLQ } = mqUtils;

const logger = loggerShared.createLogger("image-processing-service");

const app = express();
const port = Number(process.env.PORT || 4002);
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const databaseUrl = process.env.DATABASE_URL || "postgresql://pixpro:pixpro@localhost:5432/pixpro";

let mq = null;
let redis = null;
let pool = null;
let eventBus = null;

app.use(cors());
app.use(express.json());

// idempotency check helper
async function isAlreadyProcessed(imageId) {
  if (!redis) return false;
  const key = `processed_image:${imageId}`;
  
  // Check if it exists first
  const exists = await redis.get(key);
  if (exists === "completed") return true;
  
  // If not completed, we mark it as "processing"
  await redis.set(key, "processing", { EX: 3600 });
  return false;
}

app.get("/health", (_req, res) => {
  res.json({
    service: "image-processing-service",
    status: "ok",
    rabbitmq: mq ? "connected" : "disconnected",
    redis: redis?.isOpen ? "connected" : "disconnected",
    database: pool ? "connected" : "disconnected",
    cdn: isCDNConfigured ? "configured" : "mock-mode"
  });
});

app.post("/images/jobs", async (req, res) => {
  const { projectId = "project-001", imageUrl = "mock://image.png" } = req.body || {};
  const imageId = `img-${Date.now()}`;
  const cid = req.headers["x-correlation-id"];

  if (!mq) {
    logger.error("Cannot create job: MQ not connected", null, { correlationId: cid });
    return res.status(503).json({ error: "MQ not connected" });
  }

  try {
    const command = new BaseCommand(COMMAND_TYPES.REQUEST_IMAGE_PROCESSING, {
      imageId,
      projectId,
      originalUrl: imageUrl,
      requestedAt: new Date().toISOString()
    });

    const eventData = {
      imageId,
      projectId,
      originalUrl: imageUrl,
      uploadedAt: new Date().toISOString()
    };

    await publishEvent(mq.channel, EVENT_TYPES.IMAGE_UPLOADED, eventData, cid);

    logger.info(`Job created: ${imageId}`, { correlationId: cid, projectId });
    await publishCommand(
      mq.channel,
      mq.commandExchange,
      COMMAND_TYPES.REQUEST_IMAGE_PROCESSING,
      command
    );

    res.status(202).json({
      message: "Image processing command queued",
      imageId,
      command: COMMAND_TYPES.REQUEST_IMAGE_PROCESSING
    });
  } catch (err) {
    logger.error("Error creating job", err, { correlationId: cid });
    res.status(500).json({ error: "Failed to create job" });
  }
});

async function startConsumer() {
  try {
    const queueName = MQ_QUEUES.IMAGE_COMMANDS || "image_processing_queue";
    logger.info(`Asserting queue with DLQ: ${queueName}`);
    await assertQueueWithDLQ(mq.channel, queueName, EVENT_TYPES.IMAGE_UPLOADED);

    logger.info(`Consumer started for queue: ${queueName}`);

    mq.channel.consume(queueName, async (msg) => {
      if (!msg) return;

      let content;
      try {
        const body = JSON.parse(msg.content.toString());
        content = body.payload || body;
      } catch (err) {
        logger.error("Failed to parse message content", err);
        return mq.channel.nack(msg, false, false);
      }

      const { imageId, correlationId } = content;

      try {
        // idempotency check
        const alreadyDone = await isAlreadyProcessed(imageId);
        if (alreadyDone) {
          logger.warn(`Image ${imageId} already completed. Skipping.`, { correlationId });
          return mq.channel.ack(msg);
        }

        logger.info(`Processing image: ${imageId}`, { correlationId });

        // Upsert initial image state in DB (to allow retries)
        await pool.query(
          "INSERT INTO images (id, project_id, original_url, status, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET status = 'processing'",
          [imageId, content.projectId, content.originalUrl, "processing", new Date().toISOString()]
        );

        // processing simulation
        setTimeout(async () => {
          try {
            const mockProcessedBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QAwADCAICyt9uGAAAAABJRU5ErkJggg==", "base64");
            const fileName = `processed-${imageId}.png`;

            logger.info(`Attempting CDN upload for: ${fileName}`, { correlationId });
            
            const cdnUrl = await uploadToCDN(mockProcessedBuffer, fileName, "image/png");

            const processedData = {
              imageId,
              projectId: content.projectId,
              processedUrl: cdnUrl,
              metadata: { aiResult: "Person detected", storage: isCDNConfigured ? "R2" : "mock" },
              processedAt: new Date().toISOString()
            };

            await pool.query(
              "UPDATE images SET status = $1, cdn_url = $2 WHERE id = $3",
              ["completed", cdnUrl, imageId]
            );

            // Mark as completed in Redis
            if (redis) {
              const key = `processed_image:${imageId}`;
              await redis.set(key, "completed", { EX: 86400 });
              await redis.del(`projects:${content.projectId}:images`);
            }

            await eventBus.publish(EVENT_TYPES.IMAGE_PROCESSED, processedData, correlationId);
            mq.channel.ack(msg);
            logger.info(`Image processed and uploaded: ${imageId}`, { correlationId, cdnUrl });
          } catch (err) {
            console.error(`!!! CRITICAL UPLOAD ERROR for ${imageId}:`, err);
            logger.error(`Error finishing processing for ${imageId}`, err, { correlationId });
            mq.channel.nack(msg, false, true); // Requeue to try again
          }
        }, 2000);

      } catch (err) {
        logger.error(`Error processing message for ${imageId}`, err, { correlationId });
        mq.channel.nack(msg, false, true);
      }
    });
  } catch (err) {
    logger.error("Failed to start consumer", err);
  }
}

async function bootstrap() {
  try {
    app.listen(port, () => {
      logger.info(`image-processing-service listening on ${port}`);
    });

    logger.info("Connecting to PostgreSQL...");
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("SELECT 1");
    logger.info("Connected to PostgreSQL");

    logger.info("Connecting to Redis...");
    redis = await connectRedis(redisUrl, "image-processing-service");

    logger.info("Connecting to RabbitMQ...");
    mq = await connectMQ(rabbitUrl, "image-processing-service");
    
    logger.info("Initializing EventBus...");
    eventBus = new RabbitMQEventBus({
      channel: mq.channel,
      exchange: mq.eventExchange
    });

    logger.info("Starting consumer...");
    await startConsumer();

  } catch (err) {
    logger.error("Failed to bootstrap service", err);
    setTimeout(() => process.exit(1), 5000);
  }
}

bootstrap();