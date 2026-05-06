const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const { EVENT_TYPES } = require("../../shared/src/events/event-types");
const { RabbitMQEventBus } = require("../../shared/src/events/event-bus");
const { connectMQ } = require("../../shared/src/mq-utils");
const { MQ_QUEUES } = require("../../shared/src/mq-topology");

const app = express();
const port = Number(process.env.PORT || 4004);
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";

let mq = null;
let eventBus = null;

app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const wsServer = new WebSocketServer({ server, path: "/ws" });

function broadcast(message) {
  const payload = JSON.stringify(message);
  wsServer.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(payload);
    }
  });
}

wsServer.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "notification.connected",
      message: "WebSocket connected to PixPro notification-service"
    })
  );
});

app.get("/health", (_req, res) => {
  res.json({
    service: "notification-service",
    status: "ok",
    websocket: "/ws",
    rabbitmq: mq ? "connected" : "disconnected",
    redis: process.env.REDIS_URL ? "configured" : "missing"
  });
});

app.post("/notifications/status", async (req, res) => {
  try {
    const event = await eventBus.publish(
      EVENT_TYPES.NOTIFICATION_STATUS_UPDATED,
      req.body || { status: "processing", jobId: "job-001" },
      { source: "notification-service" }
    );

    broadcast(event);
    res.status(202).json({
      message: "Notification event published",
      event
    });
  } catch (error) {
    res.status(503).json({ error: "Failed to publish notification event", details: error.message });
  }
});

async function startMQConsumer() {
  await eventBus.subscribe({
    queue: MQ_QUEUES.NOTIFICATIONS,
    routingKeys: ["image.*", "project.*", EVENT_TYPES.NOTIFICATION_STATUS_UPDATED],
    handler: async (event, routingKey) => {
      console.log(`[Notification Consumer] Received: ${routingKey}`);

      broadcast({
        type: event.type || routingKey,
        payload: event.payload || event,
        metadata: event.metadata || {},
        occurredAt: event.occurredAt || new Date().toISOString()
      });
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

    await startMQConsumer();

    server.listen(port, () => {
      console.log(`notification-service listening on ${port}`);
    });
  } catch (err) {
    console.error("Failed to bootstrap service:", err);
    process.exit(1);
  }
}

bootstrap();
