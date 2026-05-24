import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import pg from "pg";
import { createClient } from "redis";
import mqUtils from "../../shared/src/mq-utils.js";
import loggerShared from "../../shared/src/logger.js";
import middlewareShared from "../../shared/src/middleware.js";
import { EVENT_TYPES } from "../../shared/src/events/event-types.js";
import RabbitMQEventBus from "../../shared/src/events/event-bus.js";
import { MQ_QUEUES } from "../../shared/src/mq-topology.js";

const { Pool } = pg;
const { connectMQ, assertQueueWithDLQ } = mqUtils;
const { createLogger } = loggerShared;
const { correlationIdMiddleware } = middlewareShared;

const app = express();
const port = Number(process.env.PORT || 4004);
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";
const databaseUrl = process.env.DATABASE_URL || "postgresql://pixpro:pixpro@localhost:5432/pixpro";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const certPath = path.join(__dirname, "..", "certs");
const options = {
  key: fs.readFileSync(path.join(certPath, "server.key")),
  cert: fs.readFileSync(path.join(certPath, "server.cert"))
};

const logger = createLogger("notification-service");
const pool = new Pool({ connectionString: databaseUrl });
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

let mq = null;
let eventBus = null;
let redisPub = null;
let redisSub = null;

app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

// Allow WSS connections in CSP
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", "connect-src 'self' wss://localhost:4004");
  next();
});

const server = https.createServer(options, app);
const wsServer = new WebSocketServer({ server, path: "/ws" });

async function broadcast(message) {
  const payload = JSON.stringify(message);
  if (redisPub && redisPub.isReady) {
    try {
      await redisPub.publish('websocket_backplane', payload);
    } catch (err) {
      logger.error("Failed to publish to Redis", err);
      wsServer.clients.forEach((client) => {
        if (client.readyState === 1) client.send(payload);
      });
    }
  } else {
    wsServer.clients.forEach((client) => {
      if (client.readyState === 1) {
        client.send(payload);
      }
    });
  }
}

wsServer.on("connection", (socket) => {
  socket.send(
    JSON.stringify({
      type: "notification.connected",
      message: "WebSocket connected to PixPro notification-service"
    })
  );
});

app.get("/test-wss", (_req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>WSS Test PixPro</title>
        <style>
          body { font-family: sans-serif; background: #1a1a1a; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
          #status { padding: 20px; border-radius: 8px; font-size: 1.5rem; font-weight: bold; background: #333; }
          .success { color: #4ade80; border: 2px solid #4ade80; }
          .error { color: #f87171; border: 2px solid #f87171; }
        </style>
      </head>
      <body>
        <h1>Capstone: Validação WSS Seguro</h1>
        <div id="status">Conectando...</div>
        <script>
          const ports = ['4004', '4005'];
          let currentPortIndex = 0;
          let socket = null;
          const statusDiv = document.getElementById('status');

          function connect() {
            const port = ports[currentPortIndex];
            statusDiv.innerText = 'Conectando na porta ' + port + '...';
            statusDiv.className = '';
            
            socket = new WebSocket('wss://' + window.location.hostname + ':' + port + '/ws');
            
            socket.onopen = () => {
              statusDiv.innerText = '🚀 WSS CONECTADO COM SUCESSO (Porta ' + port + ')!';
              statusDiv.className = 'success';
              console.log('WSS Connected to port ' + port);
            };
            
            socket.onmessage = (event) => {
              const msg = JSON.parse(event.data);
              console.log('📩 Mensagem recebida:', msg);
              const msgDiv = document.createElement('div');
              msgDiv.innerText = "[" + new Date().toLocaleTimeString() + "] Recebido: " + JSON.stringify(msg);
              msgDiv.style.marginTop = '10px';
              msgDiv.style.fontSize = '1rem';
              msgDiv.className = 'success';
              document.body.appendChild(msgDiv);
            };
            
            socket.onerror = (error) => {
              console.error('WSS Error on port ' + port);
            };
            
            socket.onclose = () => {
              statusDiv.innerText = '❌ Conexão caiu (Porta ' + port + '). Tentando reconectar...';
              statusDiv.className = 'error';
              console.log('Connection closed, retrying other instance...');
              currentPortIndex = (currentPortIndex + 1) % ports.length;
              setTimeout(connect, 3000);
            };
          }
          
          connect();
        </script>
      </body>
    </html>
  `);
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
  await mq.channel.bindQueue(queueName, mq.eventExchange, "project.*");

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

    // connect Redis Backplane
    redisPub = createClient({ url: redisUrl });
    redisSub = createClient({ url: redisUrl });

    redisPub.on('error', err => logger.error('Redis Pub Error', err));
    redisSub.on('error', err => logger.error('Redis Sub Error', err));

    await redisPub.connect();
    await redisSub.connect();

    await redisSub.subscribe('websocket_backplane', (message) => {
      wsServer.clients.forEach((client) => {
        if (client.readyState === 1) {
          client.send(message);
        }
      });
    });

    await startMQConsumer();

    server.listen(port, () => {
      logger.info(`notification-service (WSS) listening on ${port}`);
    });
  } catch (err) {
    logger.error("Failed to bootstrap service", err);
    process.exit(1);
  }
}

bootstrap();
