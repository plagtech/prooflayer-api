import { Router, Request, Response } from "express";
import { z } from "zod";
import { getSupabase } from "../utils/supabase";
import { computeScore } from "../services/scoring";

const router = Router();

// ── POST /v1/attestations/create ──────────────────────────

router.post("/create", async (req: Request, res: Response) => {
  try {
    const schema = z.object({
      walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({
        success: false,
        error: "Invalid request — walletAddress required",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const { walletAddress } = parsed.data;

    // Check minimum score requirement for attestation
    const score = await computeScore(walletAddress);
    if (score.composite < 30) {
      res.status(400).json({
        success: false,
        error: `Composite score ${score.composite} is below minimum 30 required for attestation. Keep building trust history.`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Check if signer is configured
    const signerKey = process.env.EAS_SIGNER_PRIVATE_KEY;
    if (!signerKey) {
      res.status(503).json({
        success: false,
        error: "Server-side attestation not configured. Use SDK-side attestation with your own signer, or contact support.",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Create the on-chain attestation
    let ethers: typeof import("ethers");
    try {
      ethers = await import("ethers");
    } catch {
      res.status(503).json({
        success: false,
        error: "ethers.js not available on server",
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const EAS_ADDRESS = "0x4200000000000000000000000000000000000021";
    const SCHEMA = "uint8 financial,uint8 social,uint8 reliability,uint8 trust,uint8 composite,uint64 dataPoints,uint64 computedAt,address agent";
    const schemaUid = ethers.keccak256(ethers.toUtf8Bytes(SCHEMA));

    const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const signer = new ethers.Wallet(signerKey, provider);

    const abiCoder = ethers.AbiCoder.defaultAbiCoder();
    const encodedData = abiCoder.encode(
      ["uint8", "uint8", "uint8", "uint8", "uint8", "uint64", "uint64", "address"],
      [
        score.financial,
        score.social,
        score.reliability,
        score.trust,
        score.composite,
        score.data_points,
        Math.floor(new Date(score.computed_at).getTime() / 1000),
        walletAddress,
      ]
    );

    const EAS_ABI = [
      "function attest((bytes32 schema, (address recipient, uint64 expirationTime, bool revocable, bytes32 refUID, bytes data, uint256 value) data)) external payable returns (bytes32)",
    ];

    const eas = new ethers.Contract(EAS_ADDRESS, EAS_ABI, signer);

    const tx = await eas.attest({
      schema: schemaUid,
      data: {
        recipient: walletAddress,
        expirationTime: BigInt(0),
        revocable: true,
        refUID: ethers.ZeroHash,
        data: encodedData,
        value: BigInt(0),
      },
    });

    const receipt = await tx.wait();
    const uid = receipt.logs?.[0]?.topics?.[1] || ethers.ZeroHash;

    // Store the attestation record
    const db = getSupabase();
    await db.from("pl_attestations").insert({
      uid,
      wallet_address: walletAddress,
      tx_hash: receipt.hash,
      chain_id: 8453,
      schema_id: schemaUid,
      composite_at_time: score.composite,
    });

    res.json({
      success: true,
      data: {
        uid,
        txHash: receipt.hash,
        chainId: 8453,
        schemaId: schemaUid,
        timestamp: new Date().toISOString(),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Attestation error:", err);
    res.status(500).json({
      success: false,
      error: "Attestation failed — check server logs",
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
