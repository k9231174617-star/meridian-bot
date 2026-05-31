import { Router } from "express";
import { GetPricesQueryParams } from "@workspace/api-zod";
import {
  buildPriceResponse,
  DEFAULT_PRICE_TOKENS,
  normalizePriceTokens,
  TOKEN_MINTS,
} from "../lib/prices";

const router = Router();

const pricesCache = new Map<string, { data: unknown; ts: number }>();
const CACHE_TTL = 15_000;

router.get("/", async (req, res) => {
  try {
    const query = GetPricesQueryParams.parse({
      tokens: req.query.tokens || "SOL,USDC,JUP,RAY,BONK",
    });

    const now = Date.now();
    const cacheKey = tokenListKey(query.tokens);
    const cached = pricesCache.get(cacheKey);
    if (cached && now - cached.ts < CACHE_TTL) {
      return res.json(cached.data);
    }

    const tokenList = normalizePriceTokens(query.tokens ?? DEFAULT_PRICE_TOKENS.join(","));
    const ids = tokenList.map((t: string) => TOKEN_MINTS[t] || t).join(",");

    const url = `https://api.jup.ag/price/v2?ids=${ids}`;
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    const raw = (await r.json()) as { data: Record<string, { price: string; change24h?: string }> };
    const result = buildPriceResponse(tokenList, raw.data ?? {});

    pricesCache.set(cacheKey, { data: result, ts: now });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch prices");
    return res.status(500).json({ error: "Failed to fetch prices" });
  }
});

export default router;

function tokenListKey(tokens?: string) {
  return normalizePriceTokens(tokens ?? DEFAULT_PRICE_TOKENS.join(",")).join(",");
}
