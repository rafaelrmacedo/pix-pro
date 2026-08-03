# Project Service

Project and workspace organization service.

## Responsibilities

- Manage project metadata
- Keep project context for processing batches
- Execute project commands through `CommandBus`
- Serve project queries through `QueryBus`
- Store the command/write model in PostgreSQL
- Store the query/read model projection in Redis
- Publish and consume project events through RabbitMQ

## Main endpoints

- `GET /health`
- `GET /projects`
- `GET /projects/:id`
- `POST /projects`
- `POST /projects/commands`

## CQRS Flow

`POST /projects` executes `project.create`, writes to PostgreSQL and publishes `project.created`.
The projector consumes `project.created` from `project_projection_queue` and updates Redis.
`GET /projects` and `GET /projects/:id` read from Redis.

