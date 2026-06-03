# PixPro

PixPro is an AI image processing platform built with distributed microservices.
This repository contains the initial foundation for Sprint 1, focused on:

- scalable microservices architecture
- asynchronous processing with event-driven communication
- real-time updates via WebSocket
- persistent data with PostgreSQL
- cache/support services with Redis
- infrastructure ready for Docker and GitLab CI/CD evolution

## Mandatory Stack

- Frontend: React + TypeScript (SPA)
- Backend: Node.js + Express
- Architecture: Microservices + API Gateway + EDA
- Communication: HTTP + WebSocket + RabbitMQ
- Data: PostgreSQL + Redis
- DevOps: Docker + docker-compose

## Project Structure

```text
pixpro/
|-- front/
|-- back/
|   |-- api-gateway/
|   |-- auth-service/
|   |-- image-processing-service/
|   |-- project-service/
|   |-- notification-service/
|   `-- shared/
|-- docs/
|-- docker-compose.yml
|-- README.md
`-- .gitignore
```

## Architecture Overview

- `front`: React SPA that consumes the API Gateway and can subscribe to WebSocket updates.
- `api-gateway`: single HTTP entry point for clients and orchestration of downstream service calls.
- `auth-service`: authentication entry point (mock endpoints for Sprint 1).
- `image-processing-service`: queue/job mock for image processing pipeline and event publication preparation.
- `project-service`: CQRS boundary for projects, using PostgreSQL as command/write model and Redis as query/read model.
- `notification-service`: real-time notification base with WebSocket.
- `shared`: reusable contracts for events, CQRS base structures, and WebSocket channel naming.

## CQRS + Message Broker Delivery

The activity deliverables are in:

- Main PDF-ready document: `docs/ATIVIDADE_1_CQRS_MESSAGE_BROKER.md`
- Structurizr DSL diagram: `docs/diagrams/cqrs-message-broker.dsl`
- Test evidence: `docs/evidence/test-output.txt`

Implemented flows:

- `POST /projects`: synchronous CQRS command, writes to PostgreSQL and publishes `project.created`.
- `POST /projects/commands`: asynchronous `project.create` command through RabbitMQ.
- `GET /projects` and `GET /projects/:id`: queries served from Redis read model.
- `POST /images/jobs`: publishes `image.process.requested`, consumed through RabbitMQ and converted into image events.

## Run With Docker

### Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)

### Start

```bash
docker compose up --build
```

### Deploy with Docker Swarm (Local)

For local testing with Swarm:

```bash
docker stack deploy -c docker-stack.yml pixpro
```

### Main Endpoints

- Frontend: `http://localhost:5173`
- API Gateway: `http://localhost:4000/health`
- Auth Service: `http://localhost:4001/health`
- Image Processing Service: `http://localhost:4002/health`
- Project Service: `http://localhost:4003/health`
- Notification Service: `http://localhost:4004/health`
- RabbitMQ Management: `http://localhost:15672` (`guest` / `guest`)

### Backend Tests

```bash
cd back
npm test
```

## Roadmap

Initial roadmap is documented in `docs/roadmap-inicial.md`.
