import { createClient, SupabaseClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

let supabase: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY are required");
    }
    supabase = createClient(url, key);
  }
  return supabase;
}

// ── SQL for Supabase table creation ───────────────────────
// Run this via `npm run db:setup` or paste into Supabase SQL editor

export const SETUP_SQL = `
-- Agents table — one row per registered agent
CREATE TABLE IF NOT EXISTS pl_agents (
  wallet_address TEXT PRIMARY KEY,
  registered_at TIMESTAMPTZ DEFAULT NOW(),
  sdk_version TEXT,
  chain_id INTEGER DEFAULT 8453,
  metadata JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Behavioral snapshots — raw ingested data per flush window
CREATE TABLE IF NOT EXISTS pl_snapshots (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address TEXT NOT NULL REFERENCES pl_agents(wallet_address),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  transaction_count INTEGER DEFAULT 0,
  success_count INTEGER DEFAULT 0,
  failure_count INTEGER DEFAULT 0,
  escrows_created INTEGER DEFAULT 0,
  escrows_completed INTEGER DEFAULT 0,
  escrows_disputed INTEGER DEFAULT 0,
  avg_response_time_ms INTEGER DEFAULT 0,
  uptime_percent NUMERIC(5,2) DEFAULT 0,
  unique_interactions INTEGER DEFAULT 0,
  api_call_count INTEGER DEFAULT 0,
  api_error_count INTEGER DEFAULT 0,
  event_count INTEGER DEFAULT 0,
  events JSONB DEFAULT '[]',
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_snapshots_wallet ON pl_snapshots(wallet_address);
CREATE INDEX IF NOT EXISTS idx_snapshots_ingested ON pl_snapshots(ingested_at DESC);

-- Computed scores — latest score per agent
CREATE TABLE IF NOT EXISTS pl_scores (
  wallet_address TEXT PRIMARY KEY REFERENCES pl_agents(wallet_address),
  financial INTEGER DEFAULT 0,
  social INTEGER DEFAULT 0,
  reliability INTEGER DEFAULT 0,
  trust INTEGER DEFAULT 0,
  composite INTEGER DEFAULT 0,
  data_points INTEGER DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT NOW(),
  tier TEXT DEFAULT 'Unverified'
);

-- Score history — track score changes over time
CREATE TABLE IF NOT EXISTS pl_score_history (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  wallet_address TEXT NOT NULL REFERENCES pl_agents(wallet_address),
  financial INTEGER DEFAULT 0,
  social INTEGER DEFAULT 0,
  reliability INTEGER DEFAULT 0,
  trust INTEGER DEFAULT 0,
  composite INTEGER DEFAULT 0,
  data_points INTEGER DEFAULT 0,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_score_history_wallet ON pl_score_history(wallet_address, computed_at DESC);

-- Attestations — on-chain attestation records
CREATE TABLE IF NOT EXISTS pl_attestations (
  uid TEXT PRIMARY KEY,
  wallet_address TEXT NOT NULL REFERENCES pl_agents(wallet_address),
  tx_hash TEXT NOT NULL,
  chain_id INTEGER DEFAULT 8453,
  schema_id TEXT,
  composite_at_time INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attestations_wallet ON pl_attestations(wallet_address);

-- Badges — verification status
CREATE TABLE IF NOT EXISTS pl_badges (
  wallet_address TEXT PRIMARY KEY REFERENCES pl_agents(wallet_address),
  verified BOOLEAN DEFAULT FALSE,
  verified_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  attestation_uid TEXT REFERENCES pl_attestations(uid)
);

-- Enable RLS (Row Level Security) — service key bypasses this
ALTER TABLE pl_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_score_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_attestations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pl_badges ENABLE ROW LEVEL SECURITY;

-- Public read access for scores and badges (anyone can query)
CREATE POLICY IF NOT EXISTS "Public read scores" ON pl_scores FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Public read badges" ON pl_badges FOR SELECT USING (true);
CREATE POLICY IF NOT EXISTS "Public read attestations" ON pl_attestations FOR SELECT USING (true);

-- Service key has full access (handled by Supabase automatically)
`;

// ── Run setup ─────────────────────────────────────────────

async function main() {
  console.log("Setting up ProofLayer database tables...\n");
  const db = getSupabase();

  // Split into individual statements and run them
  const statements = SETUP_SQL
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  for (const stmt of statements) {
    try {
      const { error } = await db.rpc("exec_sql", { sql: stmt + ";" });
      if (error) {
        // Try direct query if rpc isn't available
        console.log(`Statement: ${stmt.slice(0, 60)}...`);
        console.log(`Note: Run this SQL directly in Supabase SQL Editor\n`);
      }
    } catch {
      // Expected — just print the SQL for manual execution
    }
  }

  console.log("\n=== Copy the SQL above into your Supabase SQL Editor ===");
  console.log("=== Or run it via the Supabase dashboard at: ===");
  console.log("=== https://supabase.com/dashboard/project/YOUR_PROJECT/sql ===\n");
  console.log(SETUP_SQL);
}

// Only run if called directly
if (require.main === module) {
  main().catch(console.error);
}
