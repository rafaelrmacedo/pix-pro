import { randomUUID } from "crypto";

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
