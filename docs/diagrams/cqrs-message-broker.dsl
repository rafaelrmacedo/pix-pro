workspace "PixPro - CQRS + Message Broker" "Arquitetura CQRS com RabbitMQ, Postgres e Redis para o projeto final PixPro." {
  model {
    user = person "Usuario" "Usuario final que cria projetos e envia imagens para processamento."

    pixpro = softwareSystem "PixPro" "Plataforma distribuida para processamento de imagens." {
      frontend = container "Frontend SPA" "Interface web usada pelo usuario." "React + TypeScript"
      apiGateway = container "API Gateway" "Ponto unico HTTP para comandos e consultas do cliente." "Node.js + Express"

      projectService = container "Project Service" "Boundary CQRS de projetos: command handlers, query handlers e projector." "Node.js + Express" {
        tags "Service"
      }

      imageService = container "Image Processing Service" "Recebe comandos de processamento e publica eventos de imagem." "Node.js + Express" {
        tags "Service"
      }

      notificationService = container "Notification Service" "Assina eventos e envia atualizacoes em tempo real para a SPA." "Node.js + Express + WebSocket" {
        tags "Service"
      }

      postgresWrite = container "PostgreSQL Write Model" "Banco de escrita usado pelos command handlers." "PostgreSQL 16" {
        tags "Database"
      }

      redisRead = container "Redis Read Model" "Banco de leitura com projecoes otimizadas para queries." "Redis 7" {
        tags "Database"
      }

      commandExchange = container "pixpro.commands" "Exchange topic para comandos assincronos." "RabbitMQ Topic Exchange" {
        tags "Broker"
      }

      eventExchange = container "pixpro.events" "Exchange topic para eventos de dominio." "RabbitMQ Topic Exchange" {
        tags "Broker"
      }

      projectCommandQueue = container "project_command_queue" "Fila duravel que entrega project.create ao Project Service." "RabbitMQ Queue" {
        tags "Queue"
      }

      imageCommandQueue = container "image_command_queue" "Fila duravel que entrega image.process.requested ao Image Processing Service." "RabbitMQ Queue" {
        tags "Queue"
      }

      projectProjectionQueue = container "project_projection_queue" "Fila duravel usada pelo projector para atualizar o Redis." "RabbitMQ Queue" {
        tags "Queue"
      }

      notificationQueue = container "notification_queue" "Fila duravel com binding image.* e project.* para notificacoes." "RabbitMQ Queue" {
        tags "Queue"
      }
    }

    user -> frontend "Usa" "HTTPS"
    frontend -> apiGateway "Envia comandos e queries" "HTTP/JSON"
    apiGateway -> projectService "POST /projects, GET /projects, GET /projects/:id" "HTTP/JSON"
    apiGateway -> imageService "POST /images/jobs" "HTTP/JSON"

    projectService -> postgresWrite "Grava comandos no modelo de escrita" "SQL"
    projectService -> redisRead "Le queries do modelo de leitura" "Redis protocol"
    projectService -> commandExchange "Publica project.create quando o comando e assincrono" "AMQP topic"
    commandExchange -> projectCommandQueue "Roteia project.create"
    projectCommandQueue -> projectService "Entrega comandos de projeto" "AMQP consume"
    projectService -> eventExchange "Publica project.created" "AMQP topic"
    eventExchange -> projectProjectionQueue "Roteia project.created"
    projectProjectionQueue -> projectService "Aciona projector para sincronizar Redis" "AMQP consume"

    imageService -> commandExchange "Publica image.process.requested" "AMQP topic"
    commandExchange -> imageCommandQueue "Roteia image.process.requested"
    imageCommandQueue -> imageService "Entrega comando de processamento" "AMQP consume"
    imageService -> eventExchange "Publica image.uploaded, image.processed e image.error" "AMQP topic"

    eventExchange -> notificationQueue "Roteia image.* e project.*"
    notificationQueue -> notificationService "Entrega eventos para broadcast" "AMQP consume"
    notificationService -> frontend "Envia status em tempo real" "WebSocket"
  }

  views {
    container pixpro "cqrs-message-broker-containers" {
      include *
      autoLayout lr
      title "PixPro - CQRS + RabbitMQ"
      description "Separacao entre command model, query model, event bus e message broker."
    }

    dynamic pixpro "create-project-flow" {
      user -> frontend "Cria projeto"
      frontend -> apiGateway "POST /projects"
      apiGateway -> projectService "Encaminha comando"
      projectService -> postgresWrite "Persiste no modelo de escrita"
      projectService -> eventExchange "Publica project.created"
      eventExchange -> projectProjectionQueue "Entrega ao projector"
      projectProjectionQueue -> projectService "Executa projection handler"
      projectService -> redisRead "Atualiza modelo de leitura"
      frontend -> apiGateway "GET /projects"
      apiGateway -> projectService "Consulta"
      projectService -> redisRead "Le projecao"
      autoLayout lr
      title "Fluxo CQRS - Criar Projeto"
    }

    dynamic pixpro "image-processing-flow" {
      frontend -> apiGateway "POST /images/jobs"
      apiGateway -> imageService "Solicita processamento"
      imageService -> commandExchange "Publica image.process.requested"
      commandExchange -> imageCommandQueue "Entrega comando"
      imageCommandQueue -> imageService "Consome e processa"
      imageService -> eventExchange "Publica image.uploaded e image.processed"
      eventExchange -> notificationQueue "Entrega eventos"
      notificationQueue -> notificationService "Consome eventos"
      notificationService -> frontend "Notifica status"
      autoLayout lr
      title "Fluxo Assincrono - Processamento de Imagem"
    }

    styles {
      element "Person" {
        shape Person
        background #0F766E
        color #FFFFFF
      }

      element "Service" {
        background #2563EB
        color #FFFFFF
      }

      element "Database" {
        shape Cylinder
        background #047857
        color #FFFFFF
      }

      element "Broker" {
        background #7C2D12
        color #FFFFFF
      }

      element "Queue" {
        shape Pipe
        background #B45309
        color #FFFFFF
      }
    }

    theme default
  }
}
