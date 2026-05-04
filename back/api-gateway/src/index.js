const express = require("express");
const cors = require("cors");
const CircuitBreaker = require("opossum");
const { createLogger } = require("../../shared/src/logger");
const { correlationIdMiddleware } = require("../../shared/src/middleware");

const app = express();
const port = Number(process.env.PORT || 4000);
const logger = createLogger("api-gateway");

const services = {
  auth: process.env.AUTH_SERVICE_URL || "http://localhost:4001",
  image: process.env.IMAGE_SERVICE_URL || "http://localhost:4002",
  project: process.env.PROJECT_SERVICE_URL || "http://localhost:4003",
  notification: process.env.NOTIFICATION_SERVICE_URL || "http://localhost:4004"
};

const breakerOptions = {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000
};

async function fetchWithTimeout(url, options = {}, correlationId) {
  const { timeout = 5000 } = options;
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        "x-correlation-id": correlationId,
        "Content-Type": "application/json"
      },
      signal: controller.signal
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
}

const breakers = {
  auth: new CircuitBreaker((url, opts, cid) => fetchWithTimeout(url, opts, cid), breakerOptions),
  image: new CircuitBreaker((url, opts, cid) => fetchWithTimeout(url, opts, cid), breakerOptions),
  project: new CircuitBreaker((url, opts, cid) => fetchWithTimeout(url, opts, cid), breakerOptions),
  notification: new CircuitBreaker((url, opts, cid) => fetchWithTimeout(url, opts, cid), breakerOptions)
};

Object.keys(breakers).forEach(key => {
  breakers[key].on("open", () => logger.warn(`Circuit Breaker OPEN for service: ${key}`));
  breakers[key].on("close", () => logger.info(`Circuit Breaker CLOSED for service: ${key}`));
  breakers[key].on("halfOpen", () => logger.info(`Circuit Breaker HALF-OPEN for service: ${key}`));
});

app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

app.get("/health", (_req, res) => {
  res.json({
    service: "api-gateway",
    status: "ok",
    breakers: Object.keys(breakers).reduce((acc, key) => {
      acc[key] = breakers[key].opened ? "open" : "closed";
      return acc;
    }, {})
  });
});

async function proxyCall(serviceKey, path, req, res) {
  const url = `${services[serviceKey]}${path}`;
  const cid = req.correlationId;

  try {
    const response = await breakers[serviceKey].fire(url, {
      method: req.method,
      body: req.method !== "GET" ? JSON.stringify(req.body) : undefined
    }, cid);

    const payload = await response.json();
    res.status(response.status).json(payload);
  } catch (error) {
    logger.error(`Failed to proxy call to ${serviceKey}`, error, { correlationId: cid, path });

    if (error.name === "AbortError") {
      return res.status(504).json({ error: "Gateway Timeout", target: serviceKey });
    }

    if (breakers[serviceKey].opened) {
      return res.status(503).json({ error: "Service temporarily unavailable (Circuit Breaker)", target: serviceKey });
    }

    res.status(502).json({ error: "Bad Gateway", details: error.message });
  }
}

app.get("/api/:service/health", async (req, res) => {
  const { service } = req.params;
  if (!services[service]) return res.status(404).json({ error: "Service not found" });
  return proxyCall(service, "/health", req, res);
});

app.post("/images/jobs", async (req, res) => proxyCall("image", "/images/jobs", req, res));
app.get("/projects", async (req, res) => proxyCall("project", "/projects", req, res));
app.post("/projects", async (req, res) => proxyCall("project", "/projects", req, res));

app.listen(port, () => {
  logger.info(`api-gateway listening on ${port}`);
});
