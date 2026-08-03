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
- CQRS: comandos e consultas separados no `project-service`
- Event Bus: publicacao/consumo Pub-Sub sobre RabbitMQ

## CQRS + Message Broker

- Exchange de comandos: `pixpro.commands`
- Exchange de eventos: `pixpro.events`
- Modelo de escrita: PostgreSQL (`projects_write`)
- Modelo de leitura: Redis (`pixpro:read-model:projects`)
- Projector: consumidor de `project.created` que atualiza o Redis

Filas principais:

- `project_command_queue`: recebe `project.create`
- `image_command_queue`: recebe `image.process.requested`
- `project_projection_queue`: recebe `project.created`
- `notification_queue`: recebe `image.*` e `project.*`

## Fluxo base (Sprint 1)

1. Front chama API Gateway.
2. Gateway encaminha para servico alvo.
3. Comandos alteram o modelo de escrita e publicam eventos.
4. Projectors atualizam modelos de leitura de forma eventual.
5. Notification Service publica atualizacoes via WebSocket.

