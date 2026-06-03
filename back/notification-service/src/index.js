import https from "https";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parse } from "url";
import crypto from "crypto";
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
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const JWT_SECRET = process.env.JWT_SECRET || "super-secret-key";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const certPath = path.join(__dirname, "..", "certs");
const options = {
  key: fs.readFileSync(path.join(certPath, "server.key")),
  cert: fs.readFileSync(path.join(certPath, "server.cert"))
};

const logger = createLogger("notification-service");
const pool = new Pool({ connectionString: databaseUrl });

let mq = null;
let eventBus = null;
let redisPub = null;
let redisSub = null;

app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

// Allow WSS connections in CSP
app.use((_req, res, next) => {
  res.setHeader("Content-Security-Policy", "connect-src 'self' wss://localhost:4004 wss://localhost:4005");
  next();
});

const server = https.createServer(options, app);
const wsServer = new WebSocketServer({ server, path: "/ws" });

function verifyJwt(token, secret) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, signatureB64] = parts;

    const signInput = `${headerB64}.${payloadB64}`;
    const expectedSignature = crypto
      .createHmac("sha256", secret)
      .update(signInput)
      .digest("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");

    if (expectedSignature !== signatureB64) {
      return null;
    }

    const payload = JSON.parse(Buffer.from(payloadB64, "base64").toString("utf8"));
    if (payload.exp && Date.now() >= payload.exp * 1000) {
      return null;
    }

    return payload;
  } catch (err) {
    return null;
  }
}

function sendToLocalClients(message, targetUserId) {
  const payload = JSON.stringify(message);
  wsServer.clients.forEach((client) => {
    if (client.readyState === 1) {
      // Send if it's a global notification (no targetUserId) OR matches the client's userId
      if (!targetUserId || client.userId === targetUserId) {
        client.send(payload);
      }
    }
  });
}

async function broadcast(message) {
  const payload = JSON.stringify(message);
  
  // Extract target user ID from event routing or envelope payload
  const targetUserId = message.userId || message.payload?.userId || message.payload?.payload?.userId;

  if (redisPub && redisPub.isReady) {
    try {
      await redisPub.publish('websocket_backplane', payload);
    } catch (err) {
      logger.error("Failed to publish to Redis backplane", err);
      sendToLocalClients(message, targetUserId);
    }
  } else {
    sendToLocalClients(message, targetUserId);
  }
}

wsServer.on("connection", (socket, req) => {
  const parameters = parse(req.url, true).query;
  const token = parameters.token;

  if (!token) {
    logger.warn("WebSocket connection rejected: token missing");
    socket.send(JSON.stringify({ type: "error", message: "Authentication token required" }));
    socket.close(4001, "Authentication token required");
    return;
  }

  const decoded = verifyJwt(token, JWT_SECRET);
  if (!decoded) {
    logger.warn("WebSocket connection rejected: token invalid or expired");
    socket.send(JSON.stringify({ type: "error", message: "Invalid or expired token" }));
    socket.close(4002, "Invalid or expired token");
    return;
  }

  socket.userId = decoded.sub;
  socket.username = decoded.username;

  logger.info(`WebSocket secure connection established for user: ${socket.username} (${socket.userId})`);

  socket.send(
    JSON.stringify({
      type: "notification.connected",
      message: `Secure WebSocket connected. Welcome, ${socket.username}!`
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
          input { padding: 10px; margin: 10px; width: 300px; border-radius: 4px; border: none; font-size: 1rem; }
          button { padding: 10px 20px; border-radius: 4px; border: none; background: #4ade80; color: #111; font-weight: bold; cursor: pointer; }
        </style>
      </head>
      <body>
        <h1>Capstone: Validação WSS Seguro com JWT</h1>
        <input type="text" id="token" placeholder="Insira o seu token JWT..." />
        <button onclick="iniciarConexao()">Conectar com Segurança</button>
        <div id="status" style="margin-top:20px;">Insira o token para conectar</div>
        <script>
          const ports = ['4004', '4005'];
          let currentPortIndex = 0;
          let socket = null;
          const statusDiv = document.getElementById('status');

          function iniciarConexao() {
            const token = document.getElementById('token').value.trim();
            if (!token) {
              alert('Por favor insira um token!');
              return;
            }
            if (socket) socket.close();
            connect(token);
          }

          function connect(token) {
            const port = ports[currentPortIndex];
            statusDiv.innerText = 'Conectando na porta ' + port + '...';
            statusDiv.className = '';
            
            socket = new WebSocket('wss://' + window.location.hostname + ':' + port + '/ws?token=' + token);
            
            socket.onopen = () => {
              statusDiv.innerText = '🚀 WSS CONECTADO COM SUCESSO (Porta ' + port + ')!';
              statusDiv.className = 'success';
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
            
            socket.onclose = (event) => {
              if (event.code === 4001 || event.code === 4002) {
                statusDiv.innerText = '❌ Erro de Autenticação: ' + event.reason;
                statusDiv.className = 'error';
                return;
              }
              statusDiv.innerText = '❌ Conexão caiu. Tentando reconectar...';
              statusDiv.className = 'error';
              currentPortIndex = (currentPortIndex + 1) % ports.length;
              setTimeout(() => connect(token), 3000);
            };
          }
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
  const userId = req.headers["x-user-id"] || "system";
  try {
    const result = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50",
      [userId]
    );
    res.json({ notifications: result.rows });
  } catch (err) {
    logger.error(`Failed to fetch notifications for user ${userId}`, err, { correlationId: cid });
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/notifications/status", async (req, res) => {
  try {
    const userId = req.headers["x-user-id"] || req.body?.userId || "system";
    const payload = {
      ...(req.body || { status: "processing", jobId: "job-001" }),
      userId
    };

    const event = await eventBus.publish(
      EVENT_TYPES.NOTIFICATION_STATUS_UPDATED,
      payload,
      { source: "notification-service", userId }
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
  const userId = payload.userId || payload.payload?.userId || "system";
  try {
    await pool.query(
      "INSERT INTO notifications (id, type, payload, correlation_id, user_id, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [`notif-${Date.now()}`, type, JSON.stringify(payload), correlationId, userId, new Date().toISOString()]
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

      // persist notification isolated by user
      await saveNotification(routingKey, content, correlationId);

      // broadcast securely to connected clients
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
        user_id TEXT,
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

    await redisSub.subscribe('websocket_backplane', (messageStr) => {
      try {
        const message = JSON.parse(messageStr);
        const targetUserId = message.userId || message.payload?.userId || message.payload?.payload?.userId;
        sendToLocalClients(message, targetUserId);
      } catch (err) {
        logger.error("Failed to process backplane message", err);
      }
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
