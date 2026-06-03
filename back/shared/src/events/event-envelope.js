export function createEventEnvelope(type, payload, metadata = {}) {
  return {
    type,
    payload,
    metadata,
    occurredAt: new Date().toISOString()
  };
}

export default { createEventEnvelope };