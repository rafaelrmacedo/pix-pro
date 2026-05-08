<<<<<<< HEAD
import express from "express";
import cors from "cors";
import pg from "pg";
import loggerShared from "../../shared/src/logger.js";
import middlewareShared from "../../shared/src/middleware.js";

const { Pool } = pg;
const { createLogger } = loggerShared;
const { correlationIdMiddleware } = middlewareShared;

const logger = createLogger("project-service");
=======
const express = require("express");
const cors = require("cors");
const { BaseCommand } = require("../../shared/src/cqrs/base-command");
const { BaseQuery } = require("../../shared/src/cqrs/base-query");
const { CommandBus } = require("../../shared/src/cqrs/command-bus");
const { QueryBus } = require("../../shared/src/cqrs/query-bus");
const { COMMAND_TYPES } = require("../../shared/src/cqrs/command-types");
const { QUERY_TYPES } = require("../../shared/src/cqrs/query-types");
const { EVENT_TYPES } = require("../../shared/src/events/event-types");
const { RabbitMQEventBus } = require("../../shared/src/events/event-bus");
const { connectMQ, publishCommand } = require("../../shared/src/mq-utils");
const { MQ_QUEUES } = require("../../shared/src/mq-topology");
const { createProjectHandlers, createProjectProjection } = require("./project-handlers");
const { createProjectWriteRepository } = require("./postgres-write-repository");
const { createProjectReadModel } = require("./redis-read-model");
>>>>>>> 8fcf1f8ca6776398df223e14678d2222cc1d699b

const app = express();
const port = Number(process.env.PORT || 4003);
const databaseUrl = process.env.DATABASE_URL || "postgresql://pixpro:pixpro@localhost:5432/pixpro";
<<<<<<< HEAD

const pool = new Pool({
  connectionString: databaseUrl,
});
=======
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";

let mq = null;
let writeRepository = null;
let readModel = null;
let commandBus = null;
let queryBus = null;
let eventBus = null;
>>>>>>> 8fcf1f8ca6776398df223e14678d2222cc1d699b

app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

<<<<<<< HEAD
app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      service: "project-service",
      status: "ok",
      database: "connected"
    });
  } catch (err) {
    res.status(503).json({
      service: "project-service",
      status: "error",
      database: "disconnected",
      error: err.message
    });
  }
});

app.get("/projects", async (req, res) => {
  const cid = req.correlationId;
  try {
    const result = await pool.query("SELECT * FROM projects ORDER BY created_at DESC");
    res.json({ projects: result.rows });
  } catch (err) {
    logger.error("Failed to fetch projects", err, { correlationId: cid });
    res.status(500).json({ error: "Internal Server Error" });
  }
});

app.post("/projects", async (req, res) => {
  const { name = "New Project" } = req.body || {};
  const cid = req.correlationId;

  try {
    const id = `project-${Date.now()}`;
    const createdAt = new Date().toISOString();

    const result = await pool.query(
      "INSERT INTO projects (id, name, created_at) VALUES ($1, $2, $3) RETURNING *",
      [id, name, createdAt]
    );

    logger.info(`Project created: ${id}`, { correlationId: cid });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error("Failed to create project", err, { correlationId: cid });
    res.status(500).json({ error: "Internal Server Error" });
  }
});

async function bootstrap() {
  try {
    // connect to database and initialize table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
    logger.info("Database initialized");

    app.listen(port, () => {
      logger.info(`project-service listening on ${port}`);
    });
  } catch (err) {
    logger.error("Failed to bootstrap service", err);
=======
app.get("/health", (_req, res) => {
  res.json({
    service: "project-service",
    status: "ok",
    cqrs: "enabled",
    commandModel: "postgres",
    queryModel: "redis",
    database: writeRepository ? "connected" : "missing",
    redis: readModel ? "connected" : "missing",
    rabbitmq: mq ? "connected" : "disconnected"
  });
});

app.get("/projects", async (req, res) => {
  try {
    const query = new BaseQuery(QUERY_TYPES.LIST_PROJECTS, {
      name: req.query.name
    });
    const result = await queryBus.execute(query);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: "Failed to list projects", details: error.message });
  }
});

app.get("/projects/:id", async (req, res) => {
  try {
    const query = new BaseQuery(QUERY_TYPES.GET_PROJECT_BY_ID, {
      id: req.params.id
    });
    const result = await queryBus.execute(query);

    if (!result.project) {
      return res.status(404).json({ error: "Project not found" });
    }

    return res.json(result);
  } catch (error) {
    return res.status(500).json({ error: "Failed to get project", details: error.message });
  }
});

app.post("/projects", async (req, res) => {
  try {
    const command = new BaseCommand(COMMAND_TYPES.CREATE_PROJECT, req.body || {});
    const result = await commandBus.execute(command);
    res.status(201).json(result);
  } catch (error) {
    res.status(400).json({ error: "Failed to create project", details: error.message });
  }
});

app.post("/projects/commands", async (req, res) => {
  try {
    const command = new BaseCommand(COMMAND_TYPES.CREATE_PROJECT, req.body || {});
    await publishCommand(mq.channel, mq.commandExchange, COMMAND_TYPES.CREATE_PROJECT, command);

    res.status(202).json({
      message: "Project creation command queued",
      command
    });
  } catch (error) {
    res.status(503).json({ error: "Failed to queue project command", details: error.message });
  }
});

async function registerCQRSHandlers() {
  commandBus = new CommandBus();
  queryBus = new QueryBus();

  const handlers = createProjectHandlers({
    writeRepository,
    readModel,
    eventBus
  });

  commandBus.register(COMMAND_TYPES.CREATE_PROJECT, handlers.commandHandlers[COMMAND_TYPES.CREATE_PROJECT]);
  queryBus.register(QUERY_TYPES.LIST_PROJECTS, handlers.queryHandlers[QUERY_TYPES.LIST_PROJECTS]);
  queryBus.register(QUERY_TYPES.GET_PROJECT_BY_ID, handlers.queryHandlers[QUERY_TYPES.GET_PROJECT_BY_ID]);
}

async function rebuildReadModel() {
  const projects = await writeRepository.listProjects();
  await readModel.rebuildProjects(projects);
  console.log(`[Projector] Redis read model rebuilt with ${projects.length} projects`);
}

async function startProjectCommandConsumer() {
  await mq.channel.consume(MQ_QUEUES.PROJECT_COMMANDS, async (msg) => {
    if (!msg) {
      return;
    }

    const routingKey = msg.fields.routingKey;

    try {
      const payload = JSON.parse(msg.content.toString());
      const command = new BaseCommand(payload.type || routingKey, payload.payload || {});
      await commandBus.execute(command);
      mq.channel.ack(msg);
    } catch (error) {
      console.error(`[CommandConsumer] Error handling ${routingKey}:`, error.message);
      mq.channel.nack(msg, false, false);
    }
  });
}

async function startProjector() {
  const projection = createProjectProjection({ readModel });

  await eventBus.subscribe({
    queue: MQ_QUEUES.PROJECT_PROJECTIONS,
    routingKeys: [EVENT_TYPES.PROJECT_CREATED],
    handler: projection
  });
}

async function bootstrap() {
  try {
    mq = await connectMQ(rabbitUrl);
    eventBus = new RabbitMQEventBus({
      channel: mq.channel,
      exchange: mq.eventExchange
    });

    writeRepository = createProjectWriteRepository({ connectionString: databaseUrl });
    readModel = createProjectReadModel({ url: redisUrl });

    await writeRepository.init();
    await readModel.init();
    await registerCQRSHandlers();
    await rebuildReadModel();
    await startProjectCommandConsumer();
    await startProjector();

    app.listen(port, () => {
      console.log(`project-service listening on ${port}`);
    });
  } catch (err) {
    console.error("Failed to bootstrap project-service:", err);
>>>>>>> 8fcf1f8ca6776398df223e14678d2222cc1d699b
    process.exit(1);
  }
}

<<<<<<< HEAD
bootstrap();
=======
bootstrap();

>>>>>>> 8fcf1f8ca6776398df223e14678d2222cc1d699b
