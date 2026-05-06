const express = require("express");
const cors = require("cors");
const { BaseCommand } = require("../../shared/src/cqrs/base-command");
const { COMMAND_TYPES } = require("../../shared/src/cqrs/command-types");
const { EVENT_TYPES } = require("../../shared/src/events/event-types");
const { RabbitMQEventBus } = require("../../shared/src/events/event-bus");
const { connectMQ, publishCommand } = require("../../shared/src/mq-utils");
const { MQ_QUEUES } = require("../../shared/src/mq-topology");

const app = express();
const port = Number(process.env.PORT || 4002);
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";

let mq = null;
let eventBus = null;

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

  const command = new BaseCommand(COMMAND_TYPES.REQUEST_IMAGE_PROCESSING, {
    imageId,
    projectId,
    originalUrl: imageUrl,
    requestedAt: new Date().toISOString()
  });

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
  await mq.channel.prefetch(5);

  mq.channel.consume(MQ_QUEUES.IMAGE_COMMANDS, async (msg) => {
    if (msg !== null) {
      const routingKey = msg.fields.routingKey;

      try {
        const command = JSON.parse(msg.content.toString());
        const content = command.payload || {};

        console.log(`[AI Command Consumer] Received: ${content.imageId}`);

        await eventBus.publish(EVENT_TYPES.IMAGE_UPLOADED, {
          imageId: content.imageId,
          projectId: content.projectId,
          originalUrl: content.originalUrl,
          uploadedAt: new Date().toISOString()
        });

        await new Promise((resolve) => setTimeout(resolve, 2000));

        const processedData = {
          imageId: content.imageId,
          projectId: content.projectId,
          processedUrl: String(content.originalUrl).replace("mock://", "processed://"),
          metadata: { aiResult: "Person detected", confidence: 0.98 },
          processedAt: new Date().toISOString()
        };

        await eventBus.publish(EVENT_TYPES.IMAGE_PROCESSED, processedData);
        mq.channel.ack(msg);
      } catch (error) {
        console.error(`[AI Command Consumer] Error handling ${routingKey}:`, error.message);
        await eventBus.publish(EVENT_TYPES.PROCESSING_ERROR, {
          error: error.message,
          failedAt: new Date().toISOString()
        });
        mq.channel.ack(msg);
      }
    }
  });
}

async function bootstrap() {
  try {
    mq = await connectMQ(rabbitUrl);
    eventBus = new RabbitMQEventBus({
      channel: mq.channel,
      exchange: mq.eventExchange
    });

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
