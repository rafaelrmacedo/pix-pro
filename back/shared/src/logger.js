import fs from "fs";
import path from "path";
import winston from "winston";

const loggerCache = new Map();
const isTest = process.env.NODE_ENV === "test";

function ensureLogDirectory() {
  const logDirectory = process.env.LOG_DIR || path.join(process.cwd(), "logs");

  if (isTest || process.env.LOG_TO_FILE === "false") {
    return null;
  }

  fs.mkdirSync(logDirectory, { recursive: true });
  return logDirectory;
}

function sanitizeContext(context = {}) {
  return Object.fromEntries(
    Object.entries(context).filter(([, value]) => value !== undefined)
  );
}

function normalizeContext(context = {}) {
  const requestId = context.requestId || context.correlationId;

  return sanitizeContext({
    ...context,
    requestId,
    correlationId: requestId
  });
}

function createWinstonLogger(serviceName) {
  if (loggerCache.has(serviceName)) {
    return loggerCache.get(serviceName);
  }

  const transports = [
    new winston.transports.Console({ silent: isTest })
  ];
  const logDirectory = ensureLogDirectory();

  if (logDirectory) {
    transports.push(
      new winston.transports.File({
        filename: path.join(logDirectory, "app.log")
      }),
      new winston.transports.File({
        filename: path.join(logDirectory, "error.log"),
        level: "error"
      })
    );
  }

  const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || "info",
    defaultMeta: { service: serviceName },
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format((info) => {
        info.level = String(info.level).toUpperCase();
        return info;
      })(),
      winston.format.json()
    ),
    transports
  });

  loggerCache.set(serviceName, logger);
  return logger;
}

function emitTestLog(level, message, context, serviceName) {
  if (!isTest) {
    return;
  }

  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    level: level.toUpperCase(),
    service: serviceName,
    message,
    ...context
  }));
}

export function createLogger(serviceName) {
  const winstonLogger = createWinstonLogger(serviceName);

  return {
    info: (message, context = {}) => {
      log("info", message, context, serviceName, winstonLogger);
    },
    error: (message, error, context = {}) => {
      const errorContext = {
        ...context,
        error: error instanceof Error ? error.message : error,
        stack: error instanceof Error ? error.stack : undefined,
        errorName: error instanceof Error ? error.name : undefined
      };
      log("error", message, errorContext, serviceName, winstonLogger);
    },
    warn: (message, context = {}) => {
      log("warn", message, context, serviceName, winstonLogger);
    },
    debug: (message, context = {}) => {
      if (process.env.DEBUG === "true") {
        log("debug", message, context, serviceName, winstonLogger);
      }
    }
  };
}

export function log(level, message, context = {}, serviceName = "unknown", logger = null) {
  const normalizedContext = normalizeContext(context);
  const winstonLogger = logger || createWinstonLogger(serviceName);

  winstonLogger.log(level, message, normalizedContext);
  emitTestLog(level, message, normalizedContext, serviceName);
}

export default { createLogger, log };
