import express, { json } from "express";
import cors from "cors";
import CircuitBreaker from "opossum";
import { createLogger } from "../../shared/src/logger.js";
import { correlationIdMiddleware } from "../../shared/src/middleware.js";
import { createHttpObservability } from "../../shared/src/observability.js";

const app = express();
const port = Number(process.env.PORT || 4000);
const logger = createLogger("api-gateway");
const observability = createHttpObservability({
  serviceName: "api-gateway",
  logger,
  criticalModule: "projects"
});

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
        "x-request-id": correlationId,
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
app.use(json());
app.use(correlationIdMiddleware);
app.use(observability.requestLogger);
app.use(observability.metricsMiddleware);

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

app.get("/metrics", observability.metricsHandler);

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
      return res.status(504).json({ error: "Gateway Timeout", target: serviceKey, requestId: cid });
    }

    if (breakers[serviceKey].opened) {
      return res.status(503).json({
        error: "Service temporarily unavailable (Circuit Breaker)",
        target: serviceKey,
        requestId: cid
      });
    }

    res.status(502).json({ error: "Bad Gateway", details: error.message, requestId: cid });
  }
}

async function proxyJsonRequest(serviceKey, targetPath, req, res) {
  const cid = req.correlationId;

  try {
    const query = new URLSearchParams(req.query).toString();
    const targetUrl = `${services[serviceKey]}${targetPath}${query ? `?${query}` : ""}`;
    const options = {
      method: req.method,
      headers: {
        "Content-Type": "application/json",
        "x-request-id": cid,
        "x-correlation-id": cid
      }
    };

    if (!["GET", "HEAD"].includes(req.method)) {
      options.body = JSON.stringify(req.body || {});
    }

    const response = await fetch(targetUrl, options);
    const payload = await response.json();
    res.status(response.status).json(payload);
  } catch (error) {
    logger.error(`Failed to reach ${serviceKey}-service`, error, {
      correlationId: cid,
      path: targetPath
    });
    res.status(502).json({
      error: `Failed to reach ${serviceKey}-service`,
      details: error.message,
      requestId: cid
    });
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

app.get("/observability/simulate-error", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not Found", requestId: req.correlationId });
  }

  return proxyCall("project", "/observability/simulate-error", req, res);
});

app.get("/projects", async (req, res) => proxyJsonRequest("project", "/projects", req, res));
app.get("/projects/:id", async (req, res) => proxyJsonRequest("project", `/projects/${req.params.id}`, req, res));
app.post("/projects", async (req, res) => proxyJsonRequest("project", "/projects", req, res));
app.post("/projects/commands", async (req, res) => proxyJsonRequest("project", "/projects/commands", req, res));

app.get("/api/projects", async (req, res) => proxyJsonRequest("project", "/projects", req, res));
app.get("/api/projects/:id", async (req, res) => proxyJsonRequest("project", `/projects/${req.params.id}`, req, res));
app.post("/api/projects", async (req, res) => proxyJsonRequest("project", "/projects", req, res));
app.post("/api/projects/commands", async (req, res) => proxyJsonRequest("project", "/projects/commands", req, res));

app.listen(port, () => {
  logger.info(`api-gateway listening on ${port}`);
});
