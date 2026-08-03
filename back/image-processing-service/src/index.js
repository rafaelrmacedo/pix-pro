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

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

let mq = null;
let redis = null;
let pool = null;
let eventBus = null;

app.use(cors());

async function isAlreadyProcessed(imageId) {
  if (!redis) return false;
  const key = `processed_image:${imageId}`;
  const exists = await redis.get(key);
  if (exists === "completed" || exists === "processing") return true;
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

app.post("/images/jobs", upload.single("image"), async (req, res) => {
  const body = req.body || {};
  const projectId = body.projectId || req.query?.projectId;
  const { prompt, negativePrompt, steps, guidanceScale, strength } = body;
  const cid = req.headers["x-correlation-id"];
  const userId = req.headers["x-user-id"] || "system";

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

    logger.info(`Received real image upload: ${req.file.originalname} (${req.file.size} bytes) for user ${userId}`, { correlationId: cid });

    const originalUrl = await uploadToCDN(req.file.buffer, fileName, req.file.mimetype);

    const command = new BaseCommand(COMMAND_TYPES.REQUEST_IMAGE_PROCESSING, {
      imageId,
      projectId,
      originalUrl,
      userId,
      requestedAt: new Date().toISOString(),
      prompt,
      negativePrompt,
      steps: steps ? parseInt(steps, 10) : undefined,
      guidanceScale: guidanceScale ? parseFloat(guidanceScale) : undefined,
      strength: strength ? parseFloat(strength) : undefined
    });

    const eventData = {
      imageId,
      projectId,
      originalUrl,
      userId,
      uploadedAt: new Date().toISOString()
    };

    await publishEvent(mq.channel, EVENT_TYPES.IMAGE_UPLOADED, eventData, cid);

    await publishCommand(
      mq.channel,
      mq.commandExchange,
      COMMAND_TYPES.REQUEST_IMAGE_PROCESSING,
      command
    );

    if (redis) {
      const cacheKey = `projects:${projectId}:images`;
      await redis.del(cacheKey);
      logger.info(`Invalidated project images cache on upload: ${cacheKey}`, { correlationId: cid });
    }

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

app.use(express.json());

async function startConsumer() {
  try {
    const queueName = MQ_QUEUES.IMAGE_COMMANDS || "image_processing_queue";
    logger.info(`Asserting queue with DLQ: ${queueName}`);
    await assertQueueWithDLQ(mq.channel, queueName, COMMAND_TYPES.REQUEST_IMAGE_PROCESSING, mq.commandExchange);

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

        logger.info(`Processing image: ${imageId} for user: ${content.userId}`, { correlationId });

        await pool.query(
          "INSERT INTO images (id, project_id, original_url, status, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO UPDATE SET status = 'processing'",
          [imageId, content.projectId, content.originalUrl, "processing", new Date().toISOString()]
        );

        if (redis) {
          const cacheKey = `projects:${content.projectId}:images`;
          await redis.del(cacheKey);
          logger.info(`Invalidated project images cache on processing start: ${cacheKey}`, { correlationId });
        }

        let originalBuffer;
        if (content.originalUrl.includes("pub-mock.r2.dev")) {
          logger.warn(`Mock URL detected in consumer: ${content.originalUrl}. Using 1x1 png placeholder.`, { correlationId });
          originalBuffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QAwADCAICyt9uGAAAAABJRU5ErkJggg==", "base64");
        } else {
          logger.info(`Downloading original image: ${content.originalUrl}`, { correlationId });
          const downloadResponse = await fetch(content.originalUrl);
          if (!downloadResponse.ok) {
            throw new Error(`Failed to download original image from CDN (status: ${downloadResponse.status})`);
          }
          const arrayBuffer = await downloadResponse.arrayBuffer();
          originalBuffer = Buffer.from(arrayBuffer);
        }

        const juggernautUrl = process.env.JUGGERNAUT_API_URL;
        if (!juggernautUrl) {
          throw new Error("JUGGERNAUT_API_URL environment variable is not defined");
        }

        const payload = {
          prompt: content.prompt || "highly detailed image",
          negative_prompt: content.negativePrompt || "low quality, blurry, deformed, photorealistic, 3d render",
          width: 768,
          height: 768,
          num_inference_steps: content.steps || 30,
          guidance_scale: content.guidanceScale || 7.0,
          num_images_per_prompt: 1,
          strength: content.strength !== undefined ? content.strength : 0.6,
          image: originalBuffer.toString("base64")
        };

        logger.info(`Sending generation request to Juggernaut XL at: ${juggernautUrl}/img2img`, { correlationId });
        const juggernautResponse = await fetch(`${juggernautUrl}/img2img`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        if (!juggernautResponse.ok) {
          throw new Error(`Juggernaut XL API returned status: ${juggernautResponse.status}`);
        }

        const responseJson = await juggernautResponse.json();
        
        logger.info(`Received response from Juggernaut API: ${JSON.stringify(Object.keys(responseJson))}`);
        if (responseJson.detail) {
           logger.error(`API Error Detail: ${JSON.stringify(responseJson.detail)}`);
        }

        if (!responseJson.image && !responseJson.images) {
          logger.error(`Unexpected response payload: ${JSON.stringify(responseJson).substring(0, 500)}`);
          throw new Error("Invalid response format from Juggernaut XL API (missing image field)");
        }

        const base64Result = responseJson.image || responseJson.images[0];
        const processedBuffer = Buffer.from(base64Result, "base64");
        const fileName = `processed-${imageId}.png`;

        logger.info(`Uploading processed result to CDN: ${fileName}`, { correlationId });
        const cdnUrl = await uploadToCDN(processedBuffer, fileName, "image/png");

        const processedData = {
          imageId,
          projectId: content.projectId,
          processedUrl: cdnUrl,
          userId: content.userId || "system",
          metadata: { aiResult: "JuggernautXL AI generation successful", storage: isCDNConfigured ? "R2" : "mock" },
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
        logger.info(`Image processing finished successfully: ${imageId}`, { correlationId, cdnUrl });

      } catch (err) {
        logger.error(`Error processing image ${imageId}`, err, { correlationId });

        try {
          await pool.query(
            "UPDATE images SET status = 'failed' WHERE id = $1",
            [imageId]
          );
          if (redis) {
            await redis.del(`projects:${content.projectId}:images`);
          }
        } catch (dbErr) {
          logger.error(`Failed to update image status to failed in database for ${imageId}`, dbErr, { correlationId });
        }

        try {
          const errorData = {
            imageId,
            projectId: content.projectId,
            userId: content.userId || "system",
            error: err.message,
            failedAt: new Date().toISOString()
          };
          await eventBus.publish(EVENT_TYPES.PROCESSING_ERROR, errorData, correlationId);
        } catch (eventErr) {
          logger.error(`Failed to publish image error event for ${imageId}`, eventErr, { correlationId });
        }

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