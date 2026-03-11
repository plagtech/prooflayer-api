import { Request, Response, NextFunction } from "express";

/**
 * Extract agent wallet from headers.
 * The SDK sends X-Agent-Wallet on every request.
 */
export function extractWallet(req: Request, res: Response, next: NextFunction): void {
  const wallet = req.headers["x-agent-wallet"] as string | undefined;
  if (wallet && /^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    (req as any).agentWallet = wallet;
  }
  next();
}

/**
 * Require a valid wallet address (from header or route param).
 */
export function requireWallet(req: Request, res: Response, next: NextFunction): void {
  const wallet = (req as any).agentWallet || req.params.walletAddress;
  if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
    res.status(400).json({
      success: false,
      error: "Valid wallet address required (X-Agent-Wallet header or URL param)",
      timestamp: new Date().toISOString(),
    });
    return;
  }
  next();
}

/**
 * Validate API key for premium endpoints.
 * Free tier endpoints skip this.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      success: false,
      error: "API key required. Set Authorization: Bearer <key>",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const key = authHeader.slice(7);
  const validKeys = (process.env.PREMIUM_API_KEYS || "").split(",").filter(Boolean);

  // If no premium keys configured, allow all (dev mode)
  if (validKeys.length === 0) {
    next();
    return;
  }

  if (!validKeys.includes(key)) {
    res.status(403).json({
      success: false,
      error: "Invalid API key",
      timestamp: new Date().toISOString(),
    });
    return;
  }

  next();
}

/**
 * Optional API key — sets a flag if premium key is present.
 */
export function optionalApiKey(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  (req as any).isPremium = false;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    const key = authHeader.slice(7);
    const validKeys = (process.env.PREMIUM_API_KEYS || "").split(",").filter(Boolean);
    if (validKeys.length === 0 || validKeys.includes(key)) {
      (req as any).isPremium = true;
    }
  }

  next();
}
