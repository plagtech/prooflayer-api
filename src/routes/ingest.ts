import { Router, Request, Response } from "express";
import { z } from "zod";
import { getSupabase } from "../utils/supabase";
import { computeScore } from "../services/scoring";

const router = Router();

// ── Validation Schema ─────────────────────────────────────

const IngestSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  windowStart: z.string().datetime(),
  windowEnd: z.string().datetime(),
  transactionCount: z.number().int().min(0).default(0),
  successCount: z.number().int().min(0).default(0),
  failureCount: z.number().int().min(0).default(0),
  escrowsCreated: z.number().int().min(0).default(0),
  escrowsCompleted: z.number().int().min(0).default(0),
  escrowsDisputed: z.number().int().min(0).default(0),
  avgResponseTimeMs: z.number().int().min(0).default(0),
  uptimePercent: z.number().min(0).max(100).default(0),
  uniqueInteractions: z.number().int().min(0).default(0),
  apiCallCount: z.number().int().min(0).default(0),
  apiErrorCount: z.number().int().min(0).default(0),
  events: z.array(z.object({
    type: z.string(),
    timestamp: z.string(),
    metadata: z.record(z.unknown()).default({}),
  })).default([]),
});

// ── POST /v1/ingest ───────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  try {
    // Validate payload
    const parsed = IngestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: `Invalid payload: ${parsed.error.issues.map((i) => i.message).join(", ")}`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const data = parsed.data;
    const db = getSupabase();

    // Ensure agent is registered (auto-register on first ingest)
    const { data: existing } = await db
      .from("pl_agents")
      .select("wallet_address")
      .eq("wallet_address", data.walletAddress)
      .single();

    if (!existing) {
      await db.from("pl_agents").insert({
        wallet_address: data.walletAddress,
        sdk_version: req.headers["x-sdk-version"] as string || "unknown",
        registered_at: new Date().toISOString(),
      });
    }

    // Store the snapshot
    const { error: insertError } = await db.from("pl_snapshots").insert({
      wallet_address: data.walletAddress,
      window_start: data.windowStart,
      window_end: data.windowEnd,
      transaction_count: data.transactionCount,
      success_count: data.successCount,
      failure_count: data.failureCount,
      escrows_created: data.escrowsCreated,
      escrows_completed: data.escrowsCompleted,
      escrows_disputed: data.escrowsDisputed,
      avg_response_time_ms: data.avgResponseTimeMs,
      uptime_percent: data.uptimePercent,
      unique_interactions: data.uniqueInteractions,
      api_call_count: data.apiCallCount,
      api_error_count: data.apiErrorCount,
      event_count: data.events.length,
      events: data.events,
    });

    if (insertError) {
      console.error("Snapshot insert error:", insertError);
      res.status(500).json({
        success: false,
        error: "Failed to store snapshot",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Update the agent's last-seen timestamp
    await db.from("pl_agents").update({ updated_at: new Date().toISOString() })
      .eq("wallet_address", data.walletAddress);

    // Recompute the score
    const newScore = await computeScore(data.walletAddress);

    res.json({
      success: true,
      data: {
        eventsAccepted: data.events.length,
        eventsRejected: 0,
        newScore: {
          financial: newScore.financial,
          social: newScore.social,
          reliability: newScore.reliability,
          trust: newScore.trust,
          composite: newScore.composite,
          dataPoints: newScore.data_points,
          computedAt: newScore.computed_at,
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Ingest error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
