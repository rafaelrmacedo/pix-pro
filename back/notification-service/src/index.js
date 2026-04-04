const http = require("http");
const express = require("express");
const cors = require("cors");
const { WebSocketServer } = require("ws");

const app = express();
const port = Number(process.env.PORT || 4004);

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
    rabbitmq: process.env.RABBITMQ_URL ? "configured" : "missing",
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

server.listen(port, () => {
  console.log(`notification-service listening on ${port}`);
});

