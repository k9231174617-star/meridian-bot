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
const PRICE_ENDPOINTS = [
  "https://lite-api.jup.ag/price/v3",
  "https://api.jup.ag/price/v2",
];

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
    const raw = await fetchPriceMap(ids);
    const result = buildPriceResponse(tokenList, raw);

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

async function fetchPriceMap(ids: string) {
  let lastError: unknown;

  for (const endpoint of PRICE_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?ids=${ids}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) {
        lastError = new Error(`${endpoint} returned ${response.status}`);
        continue;
      }

      const raw = (await response.json()) as Record<string, unknown> | { data?: Record<string, unknown> };
      if (raw && "data" in raw && raw.data) return raw.data;
      return raw as Record<string, unknown>;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    console.warn("Falling back to empty price map after Jupiter price API failures", lastError);
  }

  return {} as Record<string, unknown>;
}
