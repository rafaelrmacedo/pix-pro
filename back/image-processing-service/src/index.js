const express = require("express");
const cors = require("cors");
const { connectMQ, publishEvent } = require("../../shared/src/mq-utils");
const { EVENT_TYPES } = require("../../shared/src/events/event-types");

const app = express();
const port = Number(process.env.PORT || 4002);
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";

let mq = null;

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    service: "image-processing-service",
    status: "ok",
    rabbitmq: mq ? "connected" : "disconnected",
    redis: process.env.REDIS_URL ? "configured" : "missing"
  });
});

app.post("/images/jobs", async (req, res) => {
  const { projectId = "project-001", imageUrl = "mock://image.png" } = req.body || {};
  const imageId = `img-${Date.now()}`;

  if (!mq) {
    return res.status(503).json({ error: "MQ not connected" });
  }

  const eventData = {
    imageId,
    projectId,
    originalUrl: imageUrl,
    uploadedAt: new Date().toISOString()
  };

  await publishEvent(mq.channel, mq.exchange, EVENT_TYPES.IMAGE_UPLOADED, eventData);

  res.status(202).json({
    message: "Image upload simulated and event emitted",
    imageId,
    event: EVENT_TYPES.IMAGE_UPLOADED
  });
});

app.get("/images/jobs/:jobId", (req, res) => {
  const { jobId } = req.params;
  res.json({
    jobId,
    status: "processing",
    outputUrl: null
  });
});

async function startConsumer() {
  const queue = "image_processing_queue";
  await mq.channel.assertQueue(queue, { durable: true });
  await mq.channel.bindQueue(queue, mq.exchange, EVENT_TYPES.IMAGE_UPLOADED);

  mq.channel.consume(queue, async (msg) => {
    if (msg !== null) {
      const content = JSON.parse(msg.content.toString());
      console.log(`[AI Consumer] Received: ${content.imageId}`);

      setTimeout(async () => {
        const processedData = {
          imageId: content.imageId,
          projectId: content.projectId,
          processedUrl: content.originalUrl.replace("mock://", "processed://"),
          metadata: { aiResult: "Person detected", confidence: 0.98 },
          processedAt: new Date().toISOString()
        };

        await publishEvent(mq.channel, mq.exchange, EVENT_TYPES.IMAGE_PROCESSED, processedData);
        mq.channel.ack(msg);
      }, 2000);
    }
  });
}

async function bootstrap() {
  try {
    mq = await connectMQ(rabbitUrl);
    await startConsumer();

    app.listen(port, () => {
      console.log(`image-processing-service listening on ${port}`);
    });
  } catch (err) {
    console.error("Failed to bootstrap service:", err);
    process.exit(1);
  }
}

bootstrap();