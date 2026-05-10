import express from "express";
import cors from "cors";
import pg from "pg";
import multer from "multer";
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

// Configure Multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

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
  const exists = await redis.get(key);
  if (exists === "completed") return true;
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

/**
 * Endpoint para receber imagens reais via multipart/form-data
 */
app.post("/images/jobs", upload.single("image"), async (req, res) => {
  const { projectId } = req.body || {};
  const cid = req.headers["x-correlation-id"];

  if (!projectId) {
    return res.status(400).json({ error: "Missing 'projectId' in request body" });
  }

  if (!req.file) {
    return res.status(400).json({ error: "No image file provided in 'image' field" });
  }

  if (!mq) {
    logger.error("Cannot create job: MQ not connected", null, { correlationId: cid });
    return res.status(503).json({ error: "MQ not connected" });
  }

  try {
    const imageId = `img-${Date.now()}`;
    const fileName = `original-${imageId}-${req.file.originalname}`;

    logger.info(`Received real image upload: ${req.file.originalname} (${req.file.size} bytes)`, { correlationId: cid });

    // 1. Upload original image to CDN immediately
    const originalUrl = await uploadToCDN(req.file.buffer, fileName, req.file.mimetype);

    // 2. Prepare command and event
    const command = new BaseCommand(COMMAND_TYPES.REQUEST_IMAGE_PROCESSING, {
      imageId,
      projectId,
      originalUrl,
      requestedAt: new Date().toISOString()
    });

    const eventData = {
      imageId,
      projectId,
      originalUrl,
      uploadedAt: new Date().toISOString()
    };

    await publishEvent(mq.channel, EVENT_TYPES.IMAGE_UPLOADED, eventData, cid);

    // 3. Queue for processing
    await publishCommand(
      mq.channel,
      mq.commandExchange,
      COMMAND_TYPES.REQUEST_IMAGE_PROCESSING,
      command
    );

    res.status(202).json({
      message: "Image uploaded and processing command queued",
      imageId,
      originalUrl,
      command: COMMAND_TYPES.REQUEST_IMAGE_PROCESSING
    });
  } catch (err) {
    logger.error("Error handling file upload", err, { correlationId: cid });
    res.status(500).json({ error: "Failed to handle upload" });
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
        const alreadyDone = await isAlreadyProcessed(imageId);
        if (alreadyDone) {
          logger.warn(`Image ${imageId} already completed. Skipping.`, { correlationId });
          return mq.channel.ack(msg);
        }

        logger.info(`Processing image: ${imageId}`, { correlationId });

        await pool.query(
          "INSERT INTO images (id, project_id, original_url, status, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET status = 'processing'",
          [imageId, content.projectId, content.originalUrl, "processing", new Date().toISOString()]
        );

        // processing simulation (IA logic would go here)
        setTimeout(async () => {
          try {
            // Simulation: Just a small buffer as result
            const mockProcessedBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QAwADCAICyt9uGAAAAABJRU5ErkJggg==", "base64");
            const fileName = `processed-${imageId}.png`;

            logger.info(`Uploading processed result to CDN: ${fileName}`, { correlationId });
            const cdnUrl = await uploadToCDN(mockProcessedBuffer, fileName, "image/png");

            const processedData = {
              imageId,
              projectId: content.projectId,
              processedUrl: cdnUrl,
              metadata: { aiResult: "Processing successful", storage: isCDNConfigured ? "R2" : "mock" },
              processedAt: new Date().toISOString()
            };

            await pool.query(
              "UPDATE images SET status = $1, cdn_url = $2 WHERE id = $3",
              ["completed", cdnUrl, imageId]
            );

            if (redis) {
              const key = `processed_image:${imageId}`;
              await redis.set(key, "completed", { EX: 86400 });
              await redis.del(`projects:${content.projectId}:images`);
            }

            await eventBus.publish(EVENT_TYPES.IMAGE_PROCESSED, processedData, correlationId);
            mq.channel.ack(msg);
            logger.info(`Image processing finished: ${imageId}`, { correlationId, cdnUrl });
          } catch (err) {
            console.error(`!!! UPLOAD ERROR for ${imageId}:`, err);
            mq.channel.nack(msg, false, false);
          }
        }, 2000);

      } catch (err) {
        logger.error(`Error processing message for ${imageId}`, err, { correlationId });
        mq.channel.nack(msg, false, false);
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

    redis = await connectRedis(redisUrl, "image-processing-service");
    mq = await connectMQ(rabbitUrl, "image-processing-service");

    eventBus = new RabbitMQEventBus({
      channel: mq.channel,
      exchange: mq.eventExchange
    });

    await startConsumer();

  } catch (err) {
    logger.error("Failed to bootstrap service", err);
    setTimeout(() => process.exit(1), 5000);
  }
}

bootstrap();