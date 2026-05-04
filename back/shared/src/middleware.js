import { randomUUID } from "crypto";

/**
 * Middleware to handle Correlation IDs.
 * Generates a new CID if not present and sets it in the request and response headers.
 */
export function correlationIdMiddleware(req, res, next) {
  const cidHeader = "x-correlation-id";
  const cid = req.headers[cidHeader] || randomUUID();

  req.correlationId = cid;
  res.setHeader(cidHeader, cid);

  next();
}

export default { correlationIdMiddleware };