# ProofLayer API

Backend API for the ProofLayer agent trust scoring system. Handles event ingestion from the SDK, score computation, report cards, trust-gating checks, badge verification, and on-chain EAS attestation creation.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | API info and endpoint list |
| `GET` | `/health` | Health check |
| `POST` | `/v1/ingest` | Ingest behavioral snapshots from SDK |
| `GET` | `/v1/score/:wallet` | Get trust score for a wallet |
| `GET` | `/v1/report/:wallet` | Full report card |
| `POST` | `/v1/agents/register` | Register an agent |
| `POST` | `/v1/trust/check` | Trust gate check for protocols |
| `GET` | `/v1/badges/:wallet` | Check verification badge status |
| `POST` | `/v1/attestations/create` | Request on-chain EAS attestation |

## Setup

### 1. Supabase

Create a Supabase project (or use your existing one). Copy the SQL from `src/utils/supabase.ts` → `SETUP_SQL` into the SQL Editor and run it. This creates 6 tables:

- `pl_agents` — registered agents
- `pl_snapshots` — raw behavioral data per flush window
- `pl_scores` — latest computed score per agent
- `pl_score_history` — score changes over time
- `pl_attestations` — on-chain attestation records
- `pl_badges` — verification badge status

### 2. Environment

```bash
cp .env.example .env
```

Fill in:
- `SUPABASE_URL` — your Supabase project URL
- `SUPABASE_SERVICE_KEY` — service role key (not anon key)
- `EAS_SIGNER_PRIVATE_KEY` — (optional) for server-side attestations
- `PREMIUM_API_KEYS` — (optional) comma-separated premium keys

### 3. Local Dev

```bash
npm install
npm run dev
```

Server starts at `http://localhost:3000`.

### 4. Deploy to Railway

```bash
# Push to GitHub first
git init && git add . && git commit -m "ProofLayer API v0.1.0"
git remote add origin https://github.com/plagtech/prooflayer-api.git
git push -u origin main

# Then in Railway:
# 1. New Project → Deploy from GitHub → select prooflayer-api
# 2. Add env vars (SUPABASE_URL, SUPABASE_SERVICE_KEY, etc.)
# 3. Railway auto-detects the Dockerfile
# 4. Add custom domain: api.prooflayer.net → CNAME to Railway
```

Railway will use the `Dockerfile` and `railway.toml` automatically.

### 5. DNS (GoDaddy)

Add a CNAME record:
- Name: `api`
- Value: `your-railway-app.up.railway.app`

## Architecture

```
SDK (prooflayer-sdk)
  │
  ├─ POST /v1/ingest ───→ Store snapshot → Recompute score → Return new score
  ├─ GET /v1/score/:w ──→ Return cached or fresh score
  ├─ GET /v1/report/:w ─→ Full report card with metadata
  ├─ POST /v1/trust/check → Protocol trust gate
  └─ POST /v1/attestations/create → On-chain EAS attestation

Frontend (prooflayer.net)
  │
  ├─ GET /v1/score/:w ──→ Score lookup page
  └─ GET /v1/report/:w ─→ Report card display

Supabase
  │
  ├─ pl_agents ─────────→ Agent registry
  ├─ pl_snapshots ──────→ Raw behavioral data
  ├─ pl_scores ─────────→ Latest scores (cached)
  ├─ pl_score_history ──→ Score timeline
  ├─ pl_attestations ───→ On-chain records
  └─ pl_badges ─────────→ Verification status
```

## License

MIT
