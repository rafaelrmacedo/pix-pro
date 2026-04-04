# Setup Inicial

## Pre-requisitos

- Docker + Docker Compose v2
- Git

## Subir ambiente completo

```bash
docker compose up --build
```

## Endpoints

- Frontend: `http://localhost:5173`
- API Gateway: `http://localhost:4000/health`
- RabbitMQ UI: `http://localhost:15672`

## Estrategia de branches

1. Trabalhar com `main` para baseline inicial.
2. Criar `dev` apos publicar `main`.

```bash
git checkout main
git pull origin main
git checkout -b dev
git push -u origin dev
```

## Convencao de commits

- `feat:`
- `fix:`
- `chore:`
- `docs:`

