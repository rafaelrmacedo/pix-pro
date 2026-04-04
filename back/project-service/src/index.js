const express = require("express");
const cors = require("cors");

const app = express();
const port = Number(process.env.PORT || 4003);

const projects = [];

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    service: "project-service",
    status: "ok",
    database: process.env.DATABASE_URL ? "configured" : "missing",
    redis: process.env.REDIS_URL ? "configured" : "missing"
  });
});

app.get("/projects", (_req, res) => {
  res.json({ projects });
});

app.post("/projects", (req, res) => {
  const { name = "New Project" } = req.body || {};
  const newProject = {
    id: `project-${Date.now()}`,
    name,
    createdAt: new Date().toISOString()
  };

  projects.push(newProject);
  res.status(201).json(newProject);
});

app.listen(port, () => {
  console.log(`project-service listening on ${port}`);
});

