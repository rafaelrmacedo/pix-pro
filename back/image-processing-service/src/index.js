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
  const result = await redis.set(key, "true", {
    NX: true,
    EX: 86400 // 24h
  });
  return result === null;
}

app.get("/health", (_req, res) => {
  res.json({
    service: "image-processing-service",
    status: "ok",
    rabbitmq: mq ? "connected" : "disconnected",
    redis: redis?.isOpen ? "connected" : "disconnected",
    database: pool ? "connected" : "disconnected"
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
        const alreadyProcessed = await isAlreadyProcessed(imageId);
        if (alreadyProcessed) {
          logger.warn(`Image ${imageId} already processed. Skipping.`, { correlationId });
          return mq.channel.ack(msg);
        }

        logger.info(`Processing image: ${imageId}`, { correlationId });

        // Persist initial image state in DB
        await pool.query(
          "INSERT INTO images (id, project_id, original_url, status, created_at) VALUES ($1, $2, $3, $4, $5)",
          [imageId, content.projectId, content.originalUrl, "processing", new Date().toISOString()]
        );

        // processing (only simulation yet)
        setTimeout(async () => {
          try {
            const processedUrl = String(content.originalUrl).replace("mock://", "processed://");
            const processedData = {
              imageId,
              projectId: content.projectId,
              processedUrl,
              metadata: { aiResult: "Person detected", confidence: 0.98 },
              processedAt: new Date().toISOString()
            };

            // Update DB with completed status
            await pool.query(
              "UPDATE images SET status = $1, cdn_url = $2 WHERE id = $3",
              ["completed", processedUrl, imageId]
            );

            // Invalidate project images cache in Redis
            if (redis) {
              await redis.del(`projects:${content.projectId}:images`);
            }

            await eventBus.publish(EVENT_TYPES.IMAGE_PROCESSED, processedData, correlationId);
            mq.channel.ack(msg);
            logger.info(`Image processed and event emitted: ${imageId}`, { correlationId });
          } catch (err) {
            logger.error(`Error finishing processing for ${imageId}`, err, { correlationId });
            mq.channel.nack(msg, false, true);
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
    // Start server first so health check works and it doesn't block
    app.listen(port, () => {
      logger.info(`image-processing-service listening on ${port}`);
    });

    // connect Database
    logger.info("Connecting to PostgreSQL...");
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("SELECT 1");
    logger.info("Connected to PostgreSQL");

    // connect Redis
    logger.info("Connecting to Redis...");
    redis = await connectRedis(redisUrl, "image-processing-service");

    // connect RabbitMQ
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