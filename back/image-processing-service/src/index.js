const express = require("express");
const cors = require("cors");

const app = express();
const port = Number(process.env.PORT || 4002);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    service: "image-processing-service",
    status: "ok",
    rabbitmq: process.env.RABBITMQ_URL ? "configured" : "missing",
    redis: process.env.REDIS_URL ? "configured" : "missing"
  });
});

app.post("/images/jobs", (req, res) => {
  const { projectId = "project-001", imageUrl = "mock://image.png" } = req.body || {};
  const jobId = `job-${Date.now()}`;

  res.status(202).json({
    message: "Mock job queued",
    jobId,
    projectId,
    imageUrl,
    event: {
      type: "image.processing.requested",
      payload: {
        jobId,
        projectId,
        imageUrl
      }
    }
  });
});

app.get("/images/jobs/:jobId", (req, res) => {
  const { jobId } = req.params;
  res.json({
    jobId,
    status: "processing",
    outputUrl: null
  });
});

app.listen(port, () => {
  console.log(`image-processing-service listening on ${port}`);
});

