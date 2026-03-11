import { Router, Request, Response } from "express";
import { z } from "zod";
import { getSupabase } from "../utils/supabase";
import { computeScore } from "../services/scoring";

const router = Router();

// ── POST /v1/trust/check ──────────────────────────────────

router.post("/check", async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      minComposite: z.number().int().min(0).max(100).default(50),
      context: z.string().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "Invalid request",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { walletAddress, minComposite, context } = parsed.data;

    // Check if the agent exists
    const db = getSupabase();
    const { data: agent } = await db
      .from("pl_agents")
      .select("wallet_address")
      .eq("wallet_address", walletAddress)
      .single();

    if (!agent) {
      res.json({
        success: true,
        data: {
          allowed: false,
          score: 0,
          tier: "Unverified",
          reason: "Agent not found — no ProofLayer history",
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Get or compute the score
    const score = await computeScore(walletAddress);

    const allowed = score.composite >= minComposite;
    let reason: string | undefined;
    if (!allowed) {
      reason = `Composite score ${score.composite} is below minimum threshold of ${minComposite}`;
    }

    // Log the trust check (for analytics — could be a separate table)
    console.log(
      `[TrustCheck] wallet=${walletAddress} composite=${score.composite} ` +
      `min=${minComposite} allowed=${allowed} context=${context || "none"}`
    );

    res.json({
      success: true,
      data: {
        allowed,
        score: score.composite,
        tier: score.tier,
        reason,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Trust check error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      timestamp: new Date().toISOString(),
    });
  }
});

// ── GET /v1/badges/:walletAddress ─────────────────────────

router.get("/badges/:walletAddress", async (req: Request, res: Response) => {
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
    const { data: badge } = await db
      .from("pl_badges")
      .select("*")
      .eq("wallet_address", walletAddress)
      .single();

    res.json({
      success: true,
      data: {
        verified: badge?.verified || false,
        verifiedAt: badge?.verified_at || null,
        expiresAt: badge?.expires_at || null,
        attestationUid: badge?.attestation_uid || null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Badge check error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
