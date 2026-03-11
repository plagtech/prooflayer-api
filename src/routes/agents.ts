import { Router, Request, Response } from "express";
import { z } from "zod";
import { getSupabase } from "../utils/supabase";

const router = Router();

// ── POST /v1/agents/register ──────────────────────────────

router.post("/register", async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
      sdkVersion: z.string().optional(),
      chainId: z.number().int().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "Invalid registration data",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { walletAddress, sdkVersion, chainId } = parsed.data;
    const db = getSupabase();

    // Upsert — idempotent registration
    const { error } = await db.from("pl_agents").upsert(
      {
        wallet_address: walletAddress,
        sdk_version: sdkVersion || "unknown",
        chain_id: chainId || 8453,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "wallet_address" }
    );

    if (error) {
      console.error("Registration error:", error);
      res.status(500).json({
        success: false,
        error: "Registration failed",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    res.json({
      success: true,
      data: { registered: true },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Registration error:", err);
    res.status(500).json({
      success: false,
      error: "Internal server error",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
