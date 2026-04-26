const express = require("express");
const cors = require("cors");

const app = express();
const port = Number(process.env.PORT || 4000);

const services = {
  auth: process.env.AUTH_SERVICE_URL || "http://localhost:4001",
  image: process.env.IMAGE_SERVICE_URL || "http://localhost:4002",
  project: process.env.PROJECT_SERVICE_URL || "http://localhost:4003",
  notification: process.env.NOTIFICATION_SERVICE_URL || "http://localhost:4004"
};

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    service: "api-gateway",
    status: "ok",
    architecture: "microservices + eda"
  });
});

app.get("/api/services", (_req, res) => {
  res.json({ services });
});

async function proxyHealthCheck(serviceKey, res) {
  try {
    const response = await fetch(`${services[serviceKey]}/health`);
    const payload = await response.json();
    res.status(response.status).json(payload);
  } catch (error) {
    res.status(503).json({
      service: "api-gateway",
      target: serviceKey,
      status: "unavailable",
      error: error.message
    });
  }
}

app.get("/api/auth/health", async (_req, res) => proxyHealthCheck("auth", res));
app.get("/api/image/health", async (_req, res) => proxyHealthCheck("image", res));
app.get("/api/project/health", async (_req, res) => proxyHealthCheck("project", res));
app.get("/api/notification/health", async (_req, res) => proxyHealthCheck("notification", res));

app.post("/images/jobs", async (req, res) => {
  try {
    const response = await fetch(`${services.image}/images/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    const payload = await response.json();
    res.status(response.status).json(payload);
  } catch (error) {
    res.status(502).json({ error: "Failed to reach image-service", details: error.message });
  }
});

app.listen(port, () => {
  console.log(`api-gateway listening on ${port}`);
});

