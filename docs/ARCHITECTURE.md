# PixPro Architecture (Inicial)

## Visao

PixPro adota arquitetura distribuida orientada a microsservicos com foco em escalabilidade para processamento de imagens em lote.

## Componentes

- Frontend SPA (`front`) em React + TypeScript
- API Gateway (`back/api-gateway`) como ponto unico de entrada
- Servicos de dominio:
  - `auth-service`
  - `image-processing-service`
  - `project-service`
  - `notification-service`
- Infra:
  - PostgreSQL
  - Redis
  - RabbitMQ

## Padroes arquiteturais

- Microservices: separacao por responsabilidade de negocio
- EDA: eventos para fluxo assincrono de processamento
- WebSocket: notificacoes de status em tempo real para UI
- CQRS (base): contratos iniciais em `back/shared/src/cqrs`

## Fluxo base (Sprint 1)

1. Front chama API Gateway.
2. Gateway encaminha para servico alvo.
3. Image Processing recebe job (mock) e retorna status inicial.
4. Notification Service pode publicar atualizacoes via WebSocket.

