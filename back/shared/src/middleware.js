import { randomUUID } from "crypto";

/**
 * Middleware to handle request/correlation IDs.
 * Reuses x-request-id or x-correlation-id when present and exposes both headers.
 */
export function correlationIdMiddleware(req, res, next) {
  const requestIdHeader = "x-request-id";
  const correlationIdHeader = "x-correlation-id";
  const incomingRequestId = getFirstHeaderValue(req.headers[requestIdHeader]);
  const incomingCorrelationId = getFirstHeaderValue(req.headers[correlationIdHeader]);
  const requestId = incomingRequestId || incomingCorrelationId || randomUUID();

  req.requestId = requestId;
  req.correlationId = requestId;
  res.setHeader(requestIdHeader, requestId);
  res.setHeader(correlationIdHeader, requestId);

  next();
}

function getFirstHeaderValue(value) {
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export default { correlationIdMiddleware };
