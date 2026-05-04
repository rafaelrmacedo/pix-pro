import express from "express";
import cors from "cors";
import pg from "pg";
import loggerShared from "../../shared/src/logger.js";
import middlewareShared from "../../shared/src/middleware.js";

const { Pool } = pg;
const { createLogger } = loggerShared;
const { correlationIdMiddleware } = middlewareShared;

const logger = createLogger("project-service");

const app = express();
const port = Number(process.env.PORT || 4003);
const databaseUrl = process.env.DATABASE_URL || "postgresql://pixpro:pixpro@localhost:5432/pixpro";

const pool = new Pool({
  connectionString: databaseUrl,
});

app.use(cors());
app.use(express.json());
app.use(correlationIdMiddleware);

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
    process.exit(1);
  }
}

bootstrap();