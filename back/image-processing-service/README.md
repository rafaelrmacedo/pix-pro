# Image Processing Service

Async image processing entry point (mock for Sprint 1).

## Responsibilities

- Receive processing requests
- Publish processing events to broker (prepared by contract)
- Track job status

## Main endpoints

- `GET /health`
- `POST /images/jobs`
- `GET /images/jobs/:jobId`

