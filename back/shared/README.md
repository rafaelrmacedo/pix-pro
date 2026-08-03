# Shared

Reusable contracts and building blocks for all backend services.

## Current content

- `src/events`: event names and event envelope contract
- `src/cqrs`: base command/query classes, command/query buses, and shared command/query types
- `src/mq-topology.js`: RabbitMQ exchanges, queues and bindings for commands and events
- `src/websocket`: shared channels and notification event names

This folder centralizes contracts used by backend services so CQRS handlers, event publishers and consumers share the same message names and broker topology.

