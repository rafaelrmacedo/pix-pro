import express from "express";
import cors from "cors";
import { createClient } from "redis";
import mqUtils from "../../shared/src/mq-utils.js";
import loggerShared from "../../shared/src/logger.js";
import { EVENT_TYPES } from "../../shared/src/events/event-types.js";

const { connectMQ, publishEvent, assertQueueWithDLQ } = mqUtils;
const logger = loggerShared.createLogger("image-processing-service");

const app = express();
const port = Number(process.env.PORT || 4002);
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

let mq = null;
let redis = null;

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
    redis: redis?.isOpen ? "connected" : "disconnected"
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

  const eventData = {
    imageId,
    projectId,
    originalUrl: imageUrl,
    uploadedAt: new Date().toISOString()
  };

  await publishEvent(mq.channel, EVENT_TYPES.IMAGE_UPLOADED, eventData, cid);

  logger.info(`Job created: ${imageId}`, { correlationId: cid, projectId });

  res.status(202).json({
    message: "Image upload simulated and event emitted",
    imageId,
    event: EVENT_TYPES.IMAGE_UPLOADED
  });
});

async function startConsumer() {
  const queueName = "image_processing_queue";
  await assertQueueWithDLQ(mq.channel, queueName, EVENT_TYPES.IMAGE_UPLOADED);

  logger.info(`Consumer started for queue: ${queueName}`);

  mq.channel.consume(queueName, async (msg) => {
    if (!msg) return;

    let content;
    try {
      content = JSON.parse(msg.content.toString());
    } catch (err) {
      logger.error("Failed to parse message content", err);
      return mq.channel.nack(msg, false, false);
    }

    const { imageId, correlationId } = content;

    try {
      // idempotency check
      const processed = await isAlreadyProcessed(imageId);
      if (processed) {
        logger.warn(`Image ${imageId} already processed. Skipping.`, { correlationId });
        return mq.channel.ack(msg);
      }

      logger.info(`Processing image: ${imageId}`, { correlationId });

      // processing (only simulation yet)
      setTimeout(async () => {
        try {
          const processedData = {
            imageId,
            projectId: content.projectId,
            processedUrl: content.originalUrl.replace("mock://", "processed://"),
            metadata: { aiResult: "Person detected", confidence: 0.98 },
            processedAt: new Date().toISOString()
          };

          await publishEvent(mq.channel, EVENT_TYPES.IMAGE_PROCESSED, processedData, correlationId);
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
}

async function bootstrap() {
  try {
    // connect Redis
    redis = createClient({ url: redisUrl });
    redis.on("error", (err) => logger.error("Redis Client Error", err));
    await redis.connect();
    logger.info("Connected to Redis");

    // connect RabbitMQ
    mq = await connectMQ(rabbitUrl, "image-processing-service");
    await startConsumer();

    app.listen(port, () => {
      logger.info(`image-processing-service listening on ${port}`);
    });
  } catch (err) {
    logger.error("Failed to bootstrap service", err);
    process.exit(1);
  }
}

bootstrap();