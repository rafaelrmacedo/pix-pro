import express, { json } from "express";
import cors from "cors";
import CircuitBreaker from "opossum";
import { createLogger } from "../../shared/src/logger.js";
import { correlationIdMiddleware } from "../../shared/src/middleware.js";
import { createHttpObservability } from "../../shared/src/observability.js";
import { authMiddleware } from "./jwt-middleware.js";

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
        "x-correlation-id": correlationId
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
app.use(correlationIdMiddleware);
app.use(observability.requestLogger);
app.use(observability.metricsMiddleware);

// Use express.json() only for non-multipart requests to preserve stream boundaries
app.use((req, res, next) => {
  const contentType = req.headers["content-type"] || "";
  if (contentType.includes("multipart/form-data")) {
    return next();
  }
  json()(req, res, next);
});

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
    const headers = {
      "x-request-id": cid,
      "x-correlation-id": cid
    };

    if (req.user) {
      headers["x-user-id"] = req.user.sub;
    }

    if (req.headers["content-type"]) {
      headers["content-type"] = req.headers["content-type"];
    }

    const hasBody = !["GET", "HEAD"].includes(req.method);
    const fetchOptions = {
      method: req.method,
      headers
    };

    if (hasBody) {
      // If content type is JSON, stringify body. Otherwise pass stream.
      const contentType = req.headers["content-type"] || "";
      if (contentType.includes("application/json")) {
        fetchOptions.body = JSON.stringify(req.body);
      } else {
        fetchOptions.body = req;
        fetchOptions.duplex = "half"; // Node fetch requirement for streams
      }
    }

    const response = await breakers[serviceKey].fire(url, fetchOptions, cid);
    const payload = await response.json();
    res.status(response.status).json(payload);
  } catch (error) {
    logger.error(`Failed to proxy call to ${serviceKey}`, error, { correlationId: cid, path });

    if (error.name === "AbortError") {
      return res.status(504).json({ error: "Gateway Timeout", target: serviceKey, requestId: cid });
    }

    if (breakers[serviceKey] && breakers[serviceKey].opened) {
      return res.status(503).json({
        error: "Service temporarily unavailable (Circuit Breaker)",
        target: serviceKey,
        requestId: cid
      });
    }

    res.status(502).json({ error: "Bad Gateway", details: error.message, requestId: cid });
  }
}

// ==========================================
// 1. PUBLIC AUTH ROUTES
// ==========================================
app.post("/api/auth/register", (req, res) => proxyCall("auth", "/auth/register", req, res));
app.post("/api/auth/login", (req, res) => proxyCall("auth", "/auth/login", req, res));

// ==========================================
// 2. PROTECTED ROUTE GROUPS
// ==========================================
app.use("/api/*", authMiddleware);
app.use("/projects*", authMiddleware);
app.use("/images*", authMiddleware);

// Profile
app.get("/api/auth/profile", (req, res) => proxyCall("auth", "/auth/profile", req, res));

// Projects / Images (Clean routes routing table)
app.get("/projects", (req, res) => proxyCall("project", "/projects", req, res));
app.post("/projects", (req, res) => proxyCall("project", "/projects", req, res));
app.get("/projects/:id", (req, res) => proxyCall("project", `/projects/${req.params.id}`, req, res));
app.get("/projects/:id/images", (req, res) => proxyCall("project", `/projects/${req.params.id}/images`, req, res));
app.delete("/projects/:id/images/:imageId", (req, res) => proxyCall("project", `/projects/${req.params.id}/images/${req.params.imageId}`, req, res));

// Standard duplicates / api/ prefixed routes
app.get("/api/projects", (req, res) => proxyCall("project", "/projects", req, res));
app.post("/api/projects", (req, res) => proxyCall("project", "/projects", req, res));
app.get("/api/projects/:id", (req, res) => proxyCall("project", `/projects/${req.params.id}`, req, res));
app.get("/api/projects/:id/images", (req, res) => proxyCall("project", `/projects/${req.params.id}/images`, req, res));
app.delete("/api/projects/:id/images/:imageId", (req, res) => proxyCall("project", `/projects/${req.params.id}/images/${req.params.imageId}`, req, res));

// Image Jobs
app.post("/images/jobs", (req, res) => proxyCall("image", "/images/jobs", req, res));
app.post("/api/images/jobs", (req, res) => proxyCall("image", "/images/jobs", req, res));

// Error Simulation
app.get("/observability/simulate-error", async (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not Found", requestId: req.correlationId });
  }
  return proxyCall("project", "/observability/simulate-error", req, res);
});

app.listen(port, () => {
  logger.info(`api-gateway listening on ${port}`);
});
