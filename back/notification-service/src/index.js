const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");
const { connectMQ } = require("../../shared/src/mq-utils");

const app = express();
const port = Number(process.env.PORT || 4004);
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";

let mq = null;

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

app.post("/notifications/status", (req, res) => {
  const event = {
    type: "notification.status.updated",
    payload: req.body || { status: "processing", jobId: "job-001" },
    emittedAt: new Date().toISOString()
  };

  broadcast(event);
  res.status(202).json({
    message: "Notification broadcasted",
    event
  });
});

async function startMQConsumer() {
  const queue = "notification_queue";
  await mq.channel.assertQueue(queue, { durable: true });

  await mq.channel.bindQueue(queue, mq.exchange, "image.*");

  mq.channel.consume(queue, (msg) => {
    if (msg !== null) {
      const routingKey = msg.fields.routingKey;
      const content = JSON.parse(msg.content.toString());

      console.log(`[Notification Consumer] Received: ${routingKey}`);

      broadcast({
        type: routingKey,
        payload: content
      });

      mq.channel.ack(msg);
    }
  });
}

async function bootstrap() {
  try {
    mq = await connectMQ(rabbitUrl);
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