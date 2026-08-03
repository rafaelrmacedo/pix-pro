# Notification Service

Realtime notification service for PixPro.

## Responsibilities

- Consume status events (broker integration in next iterations)
- Broadcast updates via WebSocket
- Expose realtime channel for UI

## Main endpoints

- `GET /health`
- `POST /notifications/status`
- `WS /ws`

