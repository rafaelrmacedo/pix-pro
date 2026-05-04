function createLogger(serviceName) {
  return {
    info: (message, context = {}) => {
      log("INFO", message, context, serviceName);
    },
    error: (message, error, context = {}) => {
      const errorContext = {
        ...context,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
      };
      log("ERROR", message, errorContext, serviceName);
    },
    warn: (message, context = {}) => {
      log("WARN", message, context, serviceName);
    },
    debug: (message, context = {}) => {
      if (process.env.DEBUG === "true") {
        log("DEBUG", message, context, serviceName);
      }
    },
  };
}

function log(level, message, context, serviceName) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    level,
    service: serviceName,
    message,
    correlationId: context.correlationId || undefined,
    ...context,
  };

  console.log(JSON.stringify(logEntry));
}

export default { createLogger };