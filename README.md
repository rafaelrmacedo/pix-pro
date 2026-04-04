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
- `project-service`: project organization endpoints (in-memory mock for initial sprint).
- `notification-service`: real-time notification base with WebSocket.
- `shared`: reusable contracts for events, CQRS base structures, and WebSocket channel naming.

## Run With Docker

### Prerequisites

- Docker Desktop (or Docker Engine + Compose v2)

### Start

```bash
docker compose up --build
```

### Main Endpoints

- Frontend: `http://localhost:5173`
- API Gateway: `http://localhost:4000/health`
- Auth Service: `http://localhost:4001/health`
- Image Processing Service: `http://localhost:4002/health`
- Project Service: `http://localhost:4003/health`
- Notification Service: `http://localhost:4004/health`
- RabbitMQ Management: `http://localhost:15672` (`guest` / `guest`)

## Branch Strategy

1. Keep `main` as stable baseline.
2. Create `dev` right after first push:

```bash
git checkout main
git pull origin main
git checkout -b dev
git push -u origin dev
```

## Commit Convention

Use a simple and consistent prefix strategy:

- `feat:` new feature
- `fix:` bug fix
- `chore:` maintenance or infra updates
- `docs:` documentation updates

Examples:

- `feat: add auth service login mock endpoint`
- `fix: correct gateway health proxy for project service`
- `chore: adjust docker compose service dependencies`

## Roadmap

Initial roadmap is documented in `docs/roadmap-inicial.md`.
