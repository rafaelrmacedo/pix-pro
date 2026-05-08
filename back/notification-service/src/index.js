import http from "http";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import pg from "pg";
import mqUtils from "../../shared/src/mq-utils.js";
import loggerShared from "../../shared/src/logger.js";
import middlewareShared from "../../shared/src/middleware.js";
import { EVENT_TYPES } from "../../shared/src/events/event-types.js";
import { RabbitMQEventBus } from "../../shared/src/events/event-bus.js";
import { MQ_QUEUES } from "../../shared/src/mq-topology.js";

const { Pool } = pg;
const { connectMQ, assertQueueWithDLQ } = mqUtils;
const { createLogger } = loggerShared;
const { correlationIdMiddleware } = middlewareShared;

const app = express();
const port = Number(process.env.PORT || 4004);
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const databaseUrl = process.env.DATABASE_URL || "postgresql://pixpro:pixpro@localhost:5432/pixpro";

const logger = createLogger("notification-service");
const pool = new Pool({ connectionString: databaseUrl });

let mq = null;
let eventBus = null;

app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

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

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      service: "notification-service",
      status: "ok",
      websocket: "/ws",
      rabbitmq: mq ? "connected" : "disconnected",
      database: "connected"
    });
  } catch (err) {
    res.status(503).json({
      service: "notification-service",
      status: "error",
      database: "disconnected",
      error: err.message
    });
  }
});

app.get("/notifications", async (req, res) => {
  const cid = req.correlationId;
  try {
    const result = await pool.query("SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50");
    res.json({ notifications: result.rows });
  } catch (err) {
    logger.error("Failed to fetch notifications", err, { correlationId: cid });
    res.status(500).json({ error: "Internal Server Error" });
  }
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

async function saveNotification(type, payload, correlationId) {
  try {
    await pool.query(
      "INSERT INTO notifications (id, type, payload, correlation_id, created_at) VALUES ($1, $2, $3, $4, $5)",
      [`notif-${Date.now()}`, type, JSON.stringify(payload), correlationId, new Date().toISOString()]
    );
  } catch (err) {
    logger.error("Failed to save notification", err, { correlationId });
  }
}

async function startMQConsumer() {
  const queueName = "notification_queue";
  await assertQueueWithDLQ(mq.channel, queueName, "image.*");

  logger.info(`Consumer started for queue: ${queueName}`);

  mq.channel.consume(queueName, async (msg) => {
    if (!msg) return;

    try {
      const routingKey = msg.fields.routingKey;
      const content = JSON.parse(msg.content.toString());
      const { correlationId } = content;

      logger.info(`Received event: ${routingKey}`, { correlationId });

      const notification = {
        type: routingKey,
        payload: content,
        correlationId
      };

      // persist notification
      await saveNotification(routingKey, content, correlationId);

      // broadcast to connected clients
      broadcast(notification);

      mq.channel.ack(msg);
    } catch (err) {
      logger.error("Error processing notification event", err);
      mq.channel.nack(msg, false, false);
    }
  });
}

async function bootstrap() {
  try {
    // connect to database and initialize table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        payload JSONB NOT NULL,
        correlation_id TEXT,
        created_at TEXT NOT NULL
      )
    `);
    logger.info("Database initialized");

    // connect RabbitMQ
    mq = await connectMQ(rabbitUrl, "notification-service");
    eventBus = new RabbitMQEventBus({
      channel: mq.channel,
      exchange: mq.eventExchange
    });

    await startMQConsumer();

    server.listen(port, () => {
      logger.info(`notification-service listening on ${port}`);
    });
  } catch (err) {
    logger.error("Failed to bootstrap service", err);
    process.exit(1);
  }
}

bootstrap();
