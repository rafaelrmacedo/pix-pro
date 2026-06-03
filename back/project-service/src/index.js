import express from "express";
import cors from "cors";
import pg from "pg";
import loggerShared from "../../shared/src/logger.js";
import middlewareShared from "../../shared/src/middleware.js";
import redisUtils from "../../shared/src/redis-utils.js";
import mqUtils from "../../shared/src/mq-utils.js";
import { createHttpObservability } from "../../shared/src/observability.js";
import RabbitMQEventBus from "../../shared/src/events/event-bus.js";
import { EVENT_TYPES } from "../../shared/src/events/event-types.js";
import { MQ_QUEUES } from "../../shared/src/mq-topology.js";
import BaseCommand from "../../shared/src/cqrs/base-command.js";
import BaseQuery from "../../shared/src/cqrs/base-query.js";
import { COMMAND_TYPES } from "../../shared/src/cqrs/command-types.js";
import { QUERY_TYPES } from "../../shared/src/cqrs/query-types.js";

import { createProjectWriteRepository } from "./postgres-write-repository.js";
import { createProjectReadModel } from "./redis-read-model.js";
import { createProjectHandlers, createProjectProjection } from "./project-handlers.js";

const { Pool } = pg;
const { createLogger } = loggerShared;
const { correlationIdMiddleware } = middlewareShared;
const { connectRedis, getOrSetCache } = redisUtils;
const { connectMQ, assertQueueWithDLQ } = mqUtils;

const logger = createLogger("project-service");
const observability = createHttpObservability({
  serviceName: "project-service",
  logger,
  criticalModule: "projects"
});

const app = express();
const port = Number(process.env.PORT || 4003);
const databaseUrl = process.env.DATABASE_URL || "postgresql://pixpro:pixpro@localhost:5432/pixpro";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
const rabbitUrl = process.env.RABBITMQ_URL || "amqp://localhost:5672";

// Active Pool for direct queries (like images)
const pool = new Pool({
  connectionString: databaseUrl,
});

let writeRepository = null;
let readModel = null;
let eventBus = null;
let mq = null;
let redis = null;
let commandHandlers = null;
let queryHandlers = null;
let projectProjection = null;

app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);
app.use(observability.requestLogger);
app.use(observability.metricsMiddleware);

app.get("/metrics", observability.metricsHandler);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      service: "project-service",
      status: "ok",
      database: "connected",
      redis: redis?.isOpen ? "connected" : "disconnected",
      rabbitmq: mq ? "connected" : "disconnected"
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

app.get("/observability/simulate-error", (req, res) => {
  const cid = req.correlationId;

  if (process.env.NODE_ENV === "production") {
    return res.status(404).json({ error: "Not Found", requestId: cid });
  }

  const error = new Error("Controlled failure in project-service observability simulation");
  observability.recordModuleFailure({
    module: "projects",
    operation: "simulate-error",
    reason: "controlled_failure"
  });

  logger.error("Controlled failure simulated in projects module", error, {
    correlationId: cid,
    requestId: cid,
    module: "projects",
    operation: "simulate-error",
    route: "/observability/simulate-error"
  });

  res.status(503).json({
    error: "Controlled observability failure",
    module: "projects",
    requestId: cid
  });
});

/**
 * Get all projects (via Redis read-model / CQRS)
 */
app.get("/projects", async (req, res) => {
  const cid = req.correlationId;
  const userId = req.headers["x-user-id"] || "system";

  try {
    const query = new BaseQuery(QUERY_TYPES.LIST_PROJECTS, { userId });
    const result = await queryHandlers[QUERY_TYPES.LIST_PROJECTS](query);
    
    let projects = result.projects;

    // Cache-aside / Rebuild model if empty
    if (!projects || projects.length === 0) {
      logger.info(`Read model cache miss. Rebuilding for user: ${userId}`);
      const dbProjects = await writeRepository.listProjects(userId);
      await readModel.rebuildProjects(userId, dbProjects);
      projects = dbProjects;
    }

    res.json({ projects });
  } catch (err) {
    observability.recordModuleFailure({
      module: "projects",
      operation: "list-projects",
      reason: err.message
    });
    logger.error("Failed to fetch projects", err, {
      correlationId: cid,
      module: "projects",
      operation: "list-projects"
    });
    res.status(500).json({ error: "Internal Server Error", requestId: cid });
  }
});

/**
 * Get a specific project by ID
 */
app.get("/projects/:id", async (req, res) => {
  const { id } = req.params;
  const cid = req.correlationId;
  const userId = req.headers["x-user-id"] || "system";

  try {
    const query = new BaseQuery(QUERY_TYPES.GET_PROJECT_BY_ID, { id });
    const result = await queryHandlers[QUERY_TYPES.GET_PROJECT_BY_ID](query);
    let project = result.project;

    if (!project) {
      const dbResult = await pool.query(
        "SELECT id, name, user_id as \"userId\", created_at as \"createdAt\" FROM projects_write WHERE id = $1",
        [id]
      );
      if (dbResult.rows.length === 0) {
        return res.status(404).json({ error: "Project not found", requestId: cid });
      }
      project = dbResult.rows[0];
      await readModel.upsertProject(project);
    }

    if (project.userId !== userId) {
      return res.status(403).json({ error: "Forbidden: Unauthorized access to project", requestId: cid });
    }

    res.json(project);
  } catch (err) {
    observability.recordModuleFailure({
      module: "projects",
      operation: "get-project",
      reason: err.message
    });
    logger.error(`Failed to fetch project ${id}`, err, {
      correlationId: cid,
      module: "projects",
      projectId: id
    });
    res.status(500).json({ error: "Internal Server Error", requestId: cid });
  }
});

/**
 * Get images for a specific project
 */
app.get("/projects/:id/images", async (req, res) => {
  const { id } = req.params;
  const cid = req.correlationId;
  const userId = req.headers["x-user-id"] || "system";

  try {
    // 1. Verify project exists and belongs to user
    const projectQuery = new BaseQuery(QUERY_TYPES.GET_PROJECT_BY_ID, { id });
    const projectResult = await queryHandlers[QUERY_TYPES.GET_PROJECT_BY_ID](projectQuery);
    let project = projectResult.project;

    if (!project) {
      const dbResult = await pool.query(
        "SELECT id, name, user_id as \"userId\" FROM projects_write WHERE id = $1",
        [id]
      );
      if (dbResult.rows.length === 0) {
        return res.status(404).json({ error: "Project not found", requestId: cid });
      }
      project = dbResult.rows[0];
    }

    if (project.userId !== userId) {
      return res.status(403).json({ error: "Forbidden: Unauthorized access to project images", requestId: cid });
    }

    // 2. Fetch images from cache or database
    const cacheKey = `projects:${id}:images`;
    const images = await getOrSetCache(redis, cacheKey, async () => {
      const result = await pool.query(
        "SELECT * FROM images WHERE project_id = $1 ORDER BY created_at ASC",
        [id]
      );
      return result.rows;
    });

    res.json({ images });
  } catch (err) {
    observability.recordModuleFailure({
      module: "projects",
      operation: "list-project-images",
      reason: err.message
    });
    logger.error(`Failed to fetch images for project ${id}`, err, {
      correlationId: cid,
      module: "projects",
      operation: "list-project-images",
      projectId: id
    });
    res.status(500).json({ error: "Internal Server Error", requestId: cid });
  }
});

/**
 * Create a new project (via CQRS command handler)
 */
app.post("/projects", async (req, res) => {
  const { name = "New Project" } = req.body || {};
  const userId = req.headers["x-user-id"] || "system";
  const cid = req.correlationId;

  try {
    const command = new BaseCommand(COMMAND_TYPES.CREATE_PROJECT, { name, userId });
    const result = await commandHandlers[COMMAND_TYPES.CREATE_PROJECT](command);

    logger.info(`Project created: ${result.project.id}`, {
      correlationId: cid,
      module: "projects",
      operation: "create-project",
      projectId: result.project.id,
      userId
    });

    res.status(201).json(result.project);
  } catch (err) {
    observability.recordModuleFailure({
      module: "projects",
      operation: "create-project",
      reason: err.message
    });
    logger.error("Failed to create project", err, {
      correlationId: cid,
      module: "projects",
      operation: "create-project",
      userId
    });
    res.status(500).json({ error: "Internal Server Error", requestId: cid });
  }
});

async function startProjectionConsumer() {
  const queueName = MQ_QUEUES.PROJECT_PROJECTIONS || "project_projection_queue";
  await assertQueueWithDLQ(mq.channel, queueName, EVENT_TYPES.PROJECT_CREATED);

  logger.info(`Projection consumer started for queue: ${queueName}`);

  mq.channel.consume(queueName, async (msg) => {
    if (!msg) return;

    try {
      const envelope = JSON.parse(msg.content.toString());
      await projectProjection(envelope);
      mq.channel.ack(msg);
    } catch (err) {
      logger.error("Failed to process projection event", err);
      mq.channel.nack(msg, false, false);
    }
  });
}

async function bootstrap() {
  try {
    // 1. Initialize write repository (PostgreSQL)
    writeRepository = createProjectWriteRepository({ connectionString: databaseUrl });
    await writeRepository.init();
    logger.info("Write model database repository initialized");

    // Initialize regular database tables (shared schema)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects_write(id),
        original_url TEXT,
        cdn_url TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_images_project_id ON images(project_id);
    `);

    // Migrate old foreign key referencing public.projects if it exists
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 
          FROM information_schema.table_constraints 
          WHERE constraint_name = 'images_project_id_fkey' AND table_name = 'images'
        ) THEN
          IF EXISTS (
            SELECT 1 
            FROM information_schema.constraint_column_usage ccu
            JOIN information_schema.table_constraints tc ON ccu.constraint_name = tc.constraint_name
            WHERE tc.constraint_name = 'images_project_id_fkey' AND ccu.table_name = 'projects'
          ) THEN
            ALTER TABLE images DROP CONSTRAINT images_project_id_fkey;
            ALTER TABLE images ADD CONSTRAINT images_project_id_fkey FOREIGN KEY (project_id) REFERENCES projects_write(id);
          END IF;
        END IF;
      END $$;
    `);
    logger.info("Shared read model images table and index initialized");

    // 2. Initialize read model (Redis)
    readModel = createProjectReadModel({ url: redisUrl });
    await readModel.init();
    redis = readModel.client; // keep reference for cache helpers
    logger.info("Read model Redis repository initialized");

    // 3. Initialize MQ & Event Bus
    mq = await connectMQ(rabbitUrl, "project-service");
    eventBus = new RabbitMQEventBus({
      channel: mq.channel,
      exchange: mq.eventExchange
    });

    // 4. Initialize Handlers and Projections
    const handlers = createProjectHandlers({ writeRepository, readModel, eventBus });
    commandHandlers = handlers.commandHandlers;
    queryHandlers = handlers.queryHandlers;
    projectProjection = createProjectProjection({ readModel });

    // 5. Start Projection Consumer
    await startProjectionConsumer();

    app.listen(port, () => {
      logger.info(`project-service listening on ${port}`);
    });
  } catch (err) {
    logger.error("Failed to bootstrap project-service", err);
    process.exit(1);
  }
}

bootstrap();
