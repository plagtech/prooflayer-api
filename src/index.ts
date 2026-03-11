import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import dotenv from "dotenv";

import { extractWallet, optionalApiKey } from "./middleware/auth";
import ingestRoutes from "./routes/ingest";
import scoreRoutes from "./routes/scores";
import agentRoutes from "./routes/agents";
import trustRoutes from "./routes/trust";
import attestationRoutes from "./routes/attestations";

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || "3000", 10);

// ── Middleware ─────────────────────────────────────────────

app.use(helmet());
app.use(cors({
  origin: "*",  // Open for SDK + frontend access; tighten in production
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Agent-Wallet", "X-SDK-Version"],
}));
app.use(express.json({ limit: "1mb" }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || "100", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Rate limit exceeded. Try again shortly.",
    timestamp: new Date().toISOString(),
  },
});
app.use(limiter);

// Extract wallet from headers on all requests
app.use(extractWallet);
app.use(optionalApiKey);

// ── Health Check ──────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({
    name: "ProofLayer API",
    version: "0.1.0",
    status: "ok",
    docs: "https://prooflayer.net/docs",
    endpoints: {
      ingest: "POST /v1/ingest",
      score: "GET /v1/score/:walletAddress",
      report: "GET /v1/report/:walletAddress",
      register: "POST /v1/agents/register",
      trustCheck: "POST /v1/trust/check",
      badges: "GET /v1/badges/:walletAddress",
      attestation: "POST /v1/attestations/create",
    },
    timestamp: new Date().toISOString(),
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// ── Routes ────────────────────────────────────────────────

app.use("/v1/ingest", ingestRoutes);
app.use("/v1", scoreRoutes);          // /v1/score/:wallet, /v1/report/:wallet
app.use("/v1/agents", agentRoutes);   // /v1/agents/register
app.use("/v1/trust", trustRoutes);    // /v1/trust/check
app.use("/v1", trustRoutes);          // /v1/badges/:wallet (mounted at root v1)
app.use("/v1/attestations", attestationRoutes);

// ── 404 Handler ───────────────────────────────────────────

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: "Endpoint not found. See / for available endpoints.",
    timestamp: new Date().toISOString(),
  });
});

// ── Error Handler ─────────────────────────────────────────

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    success: false,
    error: "Internal server error",
    timestamp: new Date().toISOString(),
  });
});

// ── Start ─────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║         PROOFLAYER API v0.1.0           ║
╚══════════════════════════════════════════╝

  Server:    http://localhost:${PORT}
  Health:    http://localhost:${PORT}/health
  Env:       ${process.env.NODE_ENV || "development"}
  
  Endpoints:
    POST /v1/ingest              Ingest behavioral snapshots
    GET  /v1/score/:wallet       Get trust score
    GET  /v1/report/:wallet      Get full report card
    POST /v1/agents/register     Register agent
    POST /v1/trust/check         Trust gate check
    GET  /v1/badges/:wallet      Check verification badge
    POST /v1/attestations/create Request on-chain attestation
  `);
});

export default app;
