# Atividade #1 - Design e Implementação de CQRS + Message Broker

## 1. Contexto do Projeto

O projeto PixPro é uma plataforma de processamento de imagens construída com microsserviços. A atividade solicitou a evolução da arquitetura para CQRS com integração de message broker, separando comandos e consultas, usando comunicação assíncrona e preparando o sistema para crescimento.

A implementação foi feita no projeto `pix-pro`, aproveitando a base já existente com API Gateway, RabbitMQ, Redis, PostgreSQL, WebSocket, `project-service`, `image-processing-service` e `notification-service`.

## 2. Design da Arquitetura

O desenho da arquitetura separa quatro responsabilidades principais:

- **Command Model:** processa intenções de mudança, valida dados e grava no banco transacional.
- **Query Model:** responde consultas a partir de uma projeção otimizada.
- **Message Broker:** transporta comandos assíncronos e eventos de domínio usando RabbitMQ.
- **Event Bus:** padroniza publicação e consumo de eventos em Pub-Sub.

O diagrama Structurizr DSL foi criado em:

`docs/diagrams/cqrs-message-broker.dsl`

Esse arquivo pode ser aberto no Structurizr DSL/Lite para gerar o diagrama visual da entrega.

### Componentes

| Componente | Função |
|---|---|
| Frontend SPA | Interface React usada pelo usuário. |
| API Gateway | Ponto único de entrada HTTP para comandos e consultas. |
| Project Service | Implementa CQRS de projetos com command handlers, query handlers e projector. |
| Image Processing Service | Recebe comando de processamento, consome fila e publica eventos de imagem. |
| Notification Service | Consome eventos e envia atualizações em tempo real via WebSocket. |
| RabbitMQ | Message broker com exchanges, filas e bindings duráveis. |
| PostgreSQL | Modelo de escrita dos comandos de projeto. |
| Redis | Modelo de leitura usado pelas queries de projeto. |

## 3. Topologia do Message Broker

Foram definidos dois exchanges principais:

| Exchange | Tipo | Uso |
|---|---|---|
| `pixpro.commands` | `topic` | Recebe comandos assíncronos. |
| `pixpro.events` | `topic` | Publica eventos de domínio para múltiplos consumidores. |

Filas e bindings:

| Fila | Exchange | Routing key | Consumidor |
|---|---|---|---|
| `project_command_queue` | `pixpro.commands` | `project.create` | `project-service` |
| `image_command_queue` | `pixpro.commands` | `image.process.requested` | `image-processing-service` |
| `project_projection_queue` | `pixpro.events` | `project.created` | projector do `project-service` |
| `notification_queue` | `pixpro.events` | `image.*`, `project.*` | `notification-service` |

A configuração fica centralizada em `back/shared/src/mq-topology.js`, evitando duplicação entre serviços.

## 4. Fluxos Implementados

### 4.1 Criar projeto com CQRS

1. O cliente envia `POST /projects` pelo API Gateway.
2. O `project-service` cria um `BaseCommand` com tipo `project.create`.
3. O `CommandBus` chama o handler registrado.
4. O handler valida o nome do projeto e grava no PostgreSQL em `projects_write`.
5. O `EventBus` publica `project.created` no exchange `pixpro.events`.
6. O projector consome `project.created` pela fila `project_projection_queue`.
7. O projector atualiza o Redis, que passa a ser o modelo de leitura.
8. As queries `GET /projects` e `GET /projects/:id` leem somente do Redis.

Também foi criado o endpoint `POST /projects/commands`, que publica o comando `project.create` em `pixpro.commands` para processamento assíncrono pela fila `project_command_queue`.

### 4.2 Processamento assíncrono de imagem

1. O cliente envia `POST /images/jobs`.
2. O `image-processing-service` publica o comando `image.process.requested` no exchange `pixpro.commands`.
3. O RabbitMQ entrega o comando na fila `image_command_queue`.
4. O consumidor do `image-processing-service` processa o comando.
5. O serviço publica os eventos `image.uploaded` e `image.processed`.
6. O `notification-service` recebe esses eventos por `notification_queue`.
7. O status é enviado para o frontend via WebSocket.

## 5. Implementação

### Arquivos principais alterados/criados

| Arquivo | Objetivo |
|---|---|
| `back/shared/src/cqrs/command-bus.js` | Registry e execução de command handlers. |
| `back/shared/src/cqrs/query-bus.js` | Registry e execução de query handlers. |
| `back/shared/src/cqrs/command-types.js` | Tipos de comandos compartilhados. |
| `back/shared/src/cqrs/query-types.js` | Tipos de queries compartilhadas. |
| `back/shared/src/events/event-bus.js` | Implementação Pub-Sub sobre RabbitMQ. |
| `back/shared/src/mq-topology.js` | Exchanges, filas e bindings RabbitMQ. |
| `back/project-service/src/project-handlers.js` | Handlers CQRS e projector de projetos. |
| `back/project-service/src/postgres-write-repository.js` | Repositório de escrita em PostgreSQL. |
| `back/project-service/src/redis-read-model.js` | Modelo de leitura em Redis. |
| `back/image-processing-service/src/index.js` | Enfileiramento e consumo de comandos de imagem. |
| `back/notification-service/src/index.js` | Consumo de eventos e broadcast WebSocket. |
| `back/api-gateway/src/index.js` | Proxy dos endpoints de projetos. |
| `docker-compose.yml` | `project-service` com RabbitMQ, Postgres e Redis. |

### Exemplo: CommandBus

```js
class CommandBus {
  constructor() {
    this.handlers = new Map();
  }

  register(type, handler) {
    this.handlers.set(type, handler);
  }

  async execute(command) {
    const handler = this.handlers.get(command.type);
    if (!handler) {
      throw new Error(`No command handler registered for ${command.type}`);
    }
    return handler(command);
  }
}
```

### Exemplo: evento de domínio

```js
await eventBus.publish(EVENT_TYPES.PROJECT_CREATED, savedProject, {
  aggregateId: savedProject.id,
  aggregateType: "project",
  source: "project-service"
});
```

### Exemplo: sincronização eventual

```js
function createProjectProjection({ readModel }) {
  return async (event) => {
    if (event.type !== EVENT_TYPES.PROJECT_CREATED) {
      return;
    }

    await readModel.upsertProject(event.payload);
  };
}
```

## 6. Persistência e Consistência Eventual

O modelo de escrita usa PostgreSQL com a tabela `projects_write`. Esse banco é responsável pela persistência transacional dos comandos.

O modelo de leitura usa Redis com as chaves:

- `pixpro:read-model:projects`
- `pixpro:read-model:projects:{id}`

A sincronização acontece por evento. Após um comando gravar no PostgreSQL, o sistema publica `project.created`. O projector consome esse evento e atualiza o Redis. Isso caracteriza consistência eventual: a escrita é confirmada primeiro, e a leitura é atualizada logo depois pelo fluxo assíncrono.

## 7. Testes e Validação

Foram adicionados testes unitários com `node:test`.

Comando executado:

```bash
cd pix-pro/back
npm test
```

Resultado:

```text
tests 9
pass 9
fail 0
```

O log completo da execução foi salvo em:

`docs/evidence/test-output.txt`

Casos de teste cobertos:

| Caso | Resultado |
|---|---|
| CommandBus executa handler registrado | Aprovado |
| CommandBus rejeita comando sem handler | Aprovado |
| QueryBus executa handler registrado | Aprovado |
| EventBus publica envelope JSON durável | Aprovado |
| EventBus consome mensagem e confirma ack | Aprovado |
| Comando `project.create` grava e publica evento | Aprovado |
| Queries leem do modelo Redis abstrato | Aprovado |
| Projection `project.created` atualiza read model | Aprovado |
| Validação rejeita nome vazio | Aprovado |

### Teste de integração sugerido com Docker

```bash
docker compose up --build
```

Criar projeto pelo caminho síncrono:

```bash
curl -X POST http://localhost:4000/projects ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Projeto CQRS\"}"
```

Consultar projeção de leitura:

```bash
curl http://localhost:4000/projects
```

Criar projeto pelo caminho assíncrono:

```bash
curl -X POST http://localhost:4000/projects/commands ^
  -H "Content-Type: application/json" ^
  -d "{\"name\":\"Projeto Assincrono\"}"
```

Enviar comando de processamento de imagem:

```bash
curl -X POST http://localhost:4000/images/jobs ^
  -H "Content-Type: application/json" ^
  -d "{\"projectId\":\"project-001\",\"imageUrl\":\"mock://foto.png\"}"
```

## 8. Conclusão

A implementação evoluiu o PixPro de uma base orientada a eventos para uma arquitetura CQRS funcional. O `project-service` agora possui separação clara entre escrita e leitura, usando PostgreSQL para comandos e Redis para consultas. O RabbitMQ passou a ter uma topologia explícita com exchanges de comandos e eventos, filas duráveis e bindings por routing key.

O principal ganho arquitetural foi o desacoplamento: comandos podem ser processados de forma síncrona ou assíncrona, eventos podem ser consumidos por mais de um serviço, e o modelo de leitura pode ser otimizado sem afetar o modelo de escrita. O principal desafio foi manter a implementação simples o suficiente para o estágio atual do projeto, mas completa o bastante para demonstrar CQRS, Pub-Sub e consistência eventual.

## 9. Referências

- RabbitMQ - Exchanges: https://www.rabbitmq.com/docs/exchanges
- RabbitMQ - Queues: https://www.rabbitmq.com/docs/queues
- RabbitMQ - Consumer acknowledgements: https://www.rabbitmq.com/docs/confirms
- Structurizr DSL: https://docs.structurizr.com/dsl
- Martin Fowler - CQRS: https://martinfowler.com/bliki/CQRS.html
- Redis documentation: https://redis.io/docs/latest/develop/data-types/strings/
- PostgreSQL documentation: https://www.postgresql.org/docs/current/
