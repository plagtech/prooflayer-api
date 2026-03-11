import { getSupabase } from "../utils/supabase";

// ── Types ─────────────────────────────────────────────────

export interface TrustScore {
  financial: number;
  social: number;
  reliability: number;
  trust: number;
  composite: number;
  data_points: number;
  computed_at: string;
  tier: string;
}

export interface SnapshotRow {
  wallet_address: string;
  transaction_count: number;
  success_count: number;
  failure_count: number;
  escrows_created: number;
  escrows_completed: number;
  escrows_disputed: number;
  avg_response_time_ms: number;
  uptime_percent: number;
  unique_interactions: number;
  api_call_count: number;
  api_error_count: number;
  event_count: number;
  window_start: string;
  window_end: string;
}

// ── Scoring Weights ───────────────────────────────────────

const WEIGHTS = {
  financial: 0.3,
  social: 0.15,
  reliability: 0.3,
  trust: 0.25,
};

// ── Tier Calculation ──────────────────────────────────────

function getTier(composite: number): string {
  if (composite >= 90) return "Platinum";
  if (composite >= 75) return "Gold";
  if (composite >= 55) return "Silver";
  if (composite >= 30) return "Bronze";
  return "Unverified";
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

// ── Score Computation from Aggregated Snapshots ───────────

export async function computeScore(walletAddress: string): Promise<TrustScore> {
  const db = getSupabase();

  // Fetch all snapshots for this agent
  const { data: snapshots, error } = await db
    .from("pl_snapshots")
    .select("*")
    .eq("wallet_address", walletAddress)
    .order("ingested_at", { ascending: true });

  if (error || !snapshots || snapshots.length === 0) {
    return emptyScore(walletAddress);
  }

  // Aggregate across all snapshots
  const agg = {
    totalTx: 0,
    totalSuccess: 0,
    totalFailures: 0,
    escrowsCreated: 0,
    escrowsCompleted: 0,
    escrowsDisputed: 0,
    responseTimes: [] as number[],
    uptimeReadings: [] as number[],
    totalApiCalls: 0,
    totalApiErrors: 0,
    uniqueInteractions: 0,
    firstSeen: snapshots[0].window_start as string,
    lastSeen: snapshots[snapshots.length - 1].window_end as string,
    snapshotCount: snapshots.length,
  };

  for (const s of snapshots) {
    agg.totalTx += s.transaction_count || 0;
    agg.totalSuccess += s.success_count || 0;
    agg.totalFailures += s.failure_count || 0;
    agg.escrowsCreated += s.escrows_created || 0;
    agg.escrowsCompleted += s.escrows_completed || 0;
    agg.escrowsDisputed += s.escrows_disputed || 0;
    if (s.avg_response_time_ms > 0) agg.responseTimes.push(s.avg_response_time_ms);
    if (s.uptime_percent > 0) agg.uptimeReadings.push(s.uptime_percent);
    agg.totalApiCalls += s.api_call_count || 0;
    agg.totalApiErrors += s.api_error_count || 0;
    agg.uniqueInteractions += s.unique_interactions || 0;
  }

  // ── Financial (0-100) ─────────────────────────────────
  let financial = 0;
  if (agg.totalTx > 0) {
    const successRate = agg.totalSuccess / agg.totalTx;
    const successScore = successRate * 40;

    let escrowScore = 0;
    if (agg.escrowsCreated > 0) {
      const completionRate = agg.escrowsCompleted / agg.escrowsCreated;
      const disputeRate = agg.escrowsDisputed / agg.escrowsCreated;
      escrowScore = completionRate * 30 - disputeRate * 15;
    }

    const volumeScore = Math.min(30, Math.log2(agg.totalTx + 1) * 5);
    financial = clamp(Math.round(successScore + escrowScore + volumeScore), 0, 100);
  }

  // ── Social (0-100) ────────────────────────────────────
  const interactionScore = Math.min(60, Math.log2(agg.uniqueInteractions + 1) * 12);
  const activityScore = Math.min(40, Math.log2(agg.snapshotCount + 1) * 8);
  const social = clamp(Math.round(interactionScore + activityScore), 0, 100);

  // ── Reliability (0-100) ───────────────────────────────
  let uptimeScore = 0;
  if (agg.uptimeReadings.length > 0) {
    const avgUptime = agg.uptimeReadings.reduce((a, b) => a + b, 0) / agg.uptimeReadings.length;
    uptimeScore = (avgUptime / 100) * 40;
  }

  let responseScore = 0;
  if (agg.responseTimes.length > 0) {
    const avgMs = agg.responseTimes.reduce((a, b) => a + b, 0) / agg.responseTimes.length;
    responseScore = Math.max(0, 30 - (avgMs / 5000) * 30);
  }

  let errorScore = 30; // Clean baseline
  if (agg.totalApiCalls > 0) {
    const errorRate = agg.totalApiErrors / agg.totalApiCalls;
    errorScore = (1 - errorRate) * 30;
  }
  const reliability = clamp(Math.round(uptimeScore + responseScore + errorScore), 0, 100);

  // ── Trust (0-100) ─────────────────────────────────────
  let ageScore = 0;
  if (agg.firstSeen) {
    const ageMs = Date.now() - new Date(agg.firstSeen).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    ageScore = Math.min(40, Math.log2(ageDays + 1) * 5);
  }

  let consistencyScore = 30;
  if (agg.escrowsCreated > 0) {
    const disputeRatio = agg.escrowsDisputed / agg.escrowsCreated;
    consistencyScore = (1 - disputeRatio) * 30;
  }

  const participationScore = Math.min(30, Math.log2(agg.snapshotCount + 1) * 6);
  const trust = clamp(Math.round(ageScore + consistencyScore + participationScore), 0, 100);

  // ── Composite ─────────────────────────────────────────
  const composite = clamp(
    Math.round(
      financial * WEIGHTS.financial +
      social * WEIGHTS.social +
      reliability * WEIGHTS.reliability +
      trust * WEIGHTS.trust
    ),
    0, 100
  );

  const dataPoints = agg.totalTx + agg.totalApiCalls;

  const score: TrustScore = {
    financial,
    social,
    reliability,
    trust,
    composite,
    data_points: dataPoints,
    computed_at: new Date().toISOString(),
    tier: getTier(composite),
  };

  // Persist to pl_scores
  await db.from("pl_scores").upsert({
    wallet_address: walletAddress,
    financial,
    social,
    reliability,
    trust,
    composite,
    data_points: dataPoints,
    computed_at: score.computed_at,
    tier: score.tier,
  });

  // Append to score history
  await db.from("pl_score_history").insert({
    wallet_address: walletAddress,
    financial,
    social,
    reliability,
    trust,
    composite,
    data_points: dataPoints,
    computed_at: score.computed_at,
  });

  return score;
}

// ── Helper ────────────────────────────────────────────────

function emptyScore(wallet: string): TrustScore {
  return {
    financial: 0,
    social: 0,
    reliability: 30, // Clean error baseline
    trust: 30,       // Clean consistency baseline
    composite: 17,
    data_points: 0,
    computed_at: new Date().toISOString(),
    tier: "Unverified",
  };
}
