import { Router, Request, Response } from "express";
import { getSupabase } from "../utils/supabase";
import { computeScore } from "../services/scoring";

const router = Router();

// ── GET /v1/score/:walletAddress ──────────────────────────

router.get("/score/:walletAddress", async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({
        success: false,
        error: "Invalid wallet address",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const db = getSupabase();

    // Check if we have a cached score
    const { data: cached } = await db
      .from("pl_scores")
      .select("*")
      .eq("wallet_address", walletAddress)
      .single();

    if (cached) {
      // Return cached score if it's less than 5 minutes old
      const age = Date.now() - new Date(cached.computed_at).getTime();
      if (age < 5 * 60 * 1000) {
        res.json({
          success: true,
          data: {
            financial: cached.financial,
            social: cached.social,
            reliability: cached.reliability,
            trust: cached.trust,
            composite: cached.composite,
            dataPoints: cached.data_points,
            computedAt: cached.computed_at,
          },
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    // Recompute if stale or missing
    const score = await computeScore(walletAddress);

    res.json({
      success: true,
      data: {
        financial: score.financial,
        social: score.social,
        reliability: score.reliability,
        trust: score.trust,
        composite: score.composite,
        dataPoints: score.data_points,
        computedAt: score.computed_at,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Score fetch error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      timestamp: new Date().toISOString(),
    });
  }
});

// ── GET /v1/report/:walletAddress ─────────────────────────

router.get("/report/:walletAddress", async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      res.status(400).json({
        success: false,
        error: "Invalid wallet address",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const db = getSupabase();

    // Get or compute the score
    const score = await computeScore(walletAddress);

    // Get agent metadata
    const { data: agent } = await db
      .from("pl_agents")
      .select("*")
      .eq("wallet_address", walletAddress)
      .single();

    // Get snapshot count for total events
    const { count: snapshotCount } = await db
      .from("pl_snapshots")
      .select("*", { count: "exact", head: true })
      .eq("wallet_address", walletAddress);

    // Get first and last snapshot timestamps
    const { data: firstSnapshot } = await db
      .from("pl_snapshots")
      .select("window_start")
      .eq("wallet_address", walletAddress)
      .order("window_start", { ascending: true })
      .limit(1)
      .single();

    const { data: lastSnapshot } = await db
      .from("pl_snapshots")
      .select("window_end")
      .eq("wallet_address", walletAddress)
      .order("window_end", { ascending: false })
      .limit(1)
      .single();

    // Get total events tracked
    const { data: eventSums } = await db
      .from("pl_snapshots")
      .select("event_count")
      .eq("wallet_address", walletAddress);

    const totalEvents = (eventSums || []).reduce(
      (sum: number, row: any) => sum + (row.event_count || 0),
      0
    );

    // Get attestation
    const { data: attestation } = await db
      .from("pl_attestations")
      .select("uid")
      .eq("wallet_address", walletAddress)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    // Get badge status
    const { data: badge } = await db
      .from("pl_badges")
      .select("verified")
      .eq("wallet_address", walletAddress)
      .single();

    res.json({
      success: true,
      data: {
        walletAddress,
        score: {
          financial: score.financial,
          social: score.social,
          reliability: score.reliability,
          trust: score.trust,
          composite: score.composite,
          dataPoints: score.data_points,
          computedAt: score.computed_at,
        },
        tier: score.tier,
        totalEventsTracked: totalEvents,
        firstSeen: firstSnapshot?.window_start || agent?.registered_at || null,
        lastSeen: lastSnapshot?.window_end || agent?.updated_at || null,
        attestationUid: attestation?.uid || null,
        verified: badge?.verified || false,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Report fetch error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
