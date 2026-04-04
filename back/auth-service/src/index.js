const express = require("express");
const cors = require("cors");

const app = express();
const port = Number(process.env.PORT || 4001);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({
    service: "auth-service",
    status: "ok",
    database: process.env.DATABASE_URL ? "configured" : "missing",
    redis: process.env.REDIS_URL ? "configured" : "missing"
  });
});

app.post("/auth/register", (req, res) => {
  const { email } = req.body || {};
  res.status(201).json({
    message: "Mock user created",
    user: {
      id: "user-001",
      email: email || "demo@pixpro.local"
    }
  });
});

app.post("/auth/login", (req, res) => {
  const { email } = req.body || {};
  res.json({
    token: "mock-jwt-token",
    user: {
      id: "user-001",
      email: email || "demo@pixpro.local"
    }
  });
});

app.listen(port, () => {
  console.log(`auth-service listening on ${port}`);
});

