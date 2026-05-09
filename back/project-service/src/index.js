import express from "express";
import cors from "cors";
import pg from "pg";
import loggerShared from "../../shared/src/logger.js";
import middlewareShared from "../../shared/src/middleware.js";
import redisUtils from "../../shared/src/redis-utils.js";

const { Pool } = pg;
const { createLogger } = loggerShared;
const { correlationIdMiddleware } = middlewareShared;
const { connectRedis, getOrSetCache } = redisUtils;

const logger = createLogger("project-service");

const app = express();
const port = Number(process.env.PORT || 4003);
const databaseUrl = process.env.DATABASE_URL || "postgresql://pixpro:pixpro@localhost:5432/pixpro";
const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

const pool = new Pool({
  connectionString: databaseUrl,
});

let redis = null;

app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      service: "project-service",
      status: "ok",
      database: "connected",
      redis: redis?.isOpen ? "connected" : "disconnected"
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

/**
 * Get all projects (with Redis caching)
 */
app.get("/projects", async (req, res) => {
  const cid = req.correlationId;
  try {
    const cacheKey = "projects:all";
    const projects = await getOrSetCache(redis, cacheKey, async () => {
      const result = await pool.query("SELECT * FROM projects ORDER BY created_at DESC");
      return result.rows;
    });
    res.json({ projects });
  } catch (err) {
    logger.error("Failed to fetch projects", err, { correlationId: cid });
    res.status(500).json({ error: "Internal Server Error" });
  }
});

/**
 * Get images for a specific project (with Redis caching)
 */
app.get("/projects/:id/images", async (req, res) => {
  const { id } = req.params;
  const cid = req.correlationId;
  try {
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
    logger.error(`Failed to fetch images for project ${id}`, err, { correlationId: cid });
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

    // Invalidate project list cache
    if (redis) {
      await redis.del("projects:all");
    }

    logger.info(`Project created: ${id}`, { correlationId: cid });
    res.status(201).json(result.rows[0]);
  } catch (err) {
    logger.error("Failed to create project", err, { correlationId: cid });
    res.status(500).json({ error: "Internal Server Error" });
  }
});

async function bootstrap() {
  try {
    // Initialize Database Tables and Indexes
    await pool.query(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS images (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id),
        original_url TEXT,
        cdn_url TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT NOT NULL
      );

      -- Optimization for High Frequency Queries
      CREATE INDEX IF NOT EXISTS idx_images_project_id ON images(project_id);
      CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects(created_at);
    `);
    logger.info("Database initialized with expanded schema and indexes");

    // Connect to Redis
    redis = await connectRedis(redisUrl, "project-service");

    app.listen(port, () => {
      logger.info(`project-service listening on ${port}`);
    });
  } catch (err) {
    logger.error("Failed to bootstrap service", err);
    process.exit(1);
  }
}

bootstrap();