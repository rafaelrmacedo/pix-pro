import client from "prom-client";

const DEFAULT_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10];

export function createHttpObservability({ serviceName, logger, criticalModule = "general" }) {
  const register = new client.Registry();
  register.setDefaultLabels({ service: serviceName });
  client.collectDefaultMetrics({ register, prefix: "pixpro_" });

  const httpRequestsTotal = new client.Counter({
    name: "http_requests_total",
    help: "Total HTTP requests handled by the service.",
    labelNames: ["method", "route", "status_code"],
    registers: [register]
  });

  const httpRequestDurationSeconds = new client.Histogram({
    name: "http_request_duration_seconds",
    help: "HTTP request duration in seconds.",
    labelNames: ["method", "route", "status_code"],
    buckets: DEFAULT_BUCKETS,
    registers: [register]
  });

  const httpErrorsTotal = new client.Counter({
    name: "http_errors_total",
    help: "Total HTTP requests completed with client or server error status.",
    labelNames: ["method", "route", "status_code"],
    registers: [register]
  });

  const capstoneModuleFailuresTotal = new client.Counter({
    name: "capstone_module_failures_total",
    help: "Controlled and real failures observed in the selected Capstone module.",
    labelNames: ["module", "operation", "reason"],
    registers: [register]
  });

  function requestLogger(req, res, next) {
    const startedAt = process.hrtime.bigint();
    const requestId = req.requestId || req.correlationId;

    logger.info("HTTP request started", {
      requestId,
      correlationId: requestId,
      method: req.method,
      route: req.originalUrl,
      module: inferModule(req.originalUrl)
    });

    res.on("finish", () => {
      const responseTimeMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const statusCode = res.statusCode;
      const context = {
        requestId,
        correlationId: requestId,
        method: req.method,
        route: getRouteLabel(req),
        statusCode,
        responseTime: `${responseTimeMs.toFixed(2)}ms`,
        module: inferModule(req.originalUrl)
      };

      if (statusCode >= 500) {
        logger.error("HTTP request finished with server error", `HTTP ${statusCode}`, context);
        return;
      }

      if (statusCode >= 400) {
        logger.warn("HTTP request finished with client error", context);
        return;
      }

      logger.info("HTTP request finished", context);
    });

    next();
  }

  function metricsMiddleware(req, res, next) {
    const startedAt = process.hrtime.bigint();

    res.on("finish", () => {
      const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      const labels = {
        method: req.method,
        route: getRouteLabel(req),
        status_code: String(res.statusCode)
      };

      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationSeconds);

      if (res.statusCode >= 400) {
        httpErrorsTotal.inc(labels);
      }
    });

    next();
  }

  async function metricsHandler(_req, res) {
    res.set("Content-Type", register.contentType);
    res.end(await register.metrics());
  }

  function recordModuleFailure({ module = criticalModule, operation = "unknown", reason = "unknown" } = {}) {
    capstoneModuleFailuresTotal.inc({ module, operation, reason });
  }

  return {
    register,
    requestLogger,
    metricsMiddleware,
    metricsHandler,
    recordModuleFailure,
    metrics: {
      httpRequestsTotal,
      httpRequestDurationSeconds,
      httpErrorsTotal,
      capstoneModuleFailuresTotal
    }
  };
}

export function getRouteLabel(req) {
  const routePath = normalizeRoutePath(req.route?.path);
  const baseUrl = req.baseUrl || "";

  if (routePath) {
    return `${baseUrl}${routePath}`.replace(/\/+/g, "/") || "/";
  }

  return sanitizeDynamicPath(req.path || req.originalUrl || "unknown");
}

function normalizeRoutePath(routePath) {
  if (!routePath) {
    return null;
  }

  if (Array.isArray(routePath)) {
    return routePath.join("|");
  }

  return String(routePath);
}

function sanitizeDynamicPath(path) {
  return String(path)
    .split("?")[0]
    .replace(/\/project-[^/]+/g, "/:projectId")
    .replace(/\/img-[^/]+/g, "/:imageId")
    .replace(/\/[0-9a-fA-F-]{24,}/g, "/:id");
}

function inferModule(path = "") {
  if (path.startsWith("/projects") || path.startsWith("/api/projects")) {
    return "projects";
  }

  if (path.startsWith("/images")) {
    return "images";
  }

  if (path.startsWith("/notifications")) {
    return "notifications";
  }

  if (path.startsWith("/observability")) {
    return "observability";
  }

  return "platform";
}

export default { createHttpObservability, getRouteLabel };
