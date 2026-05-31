import { Router } from "express";
import { GetPricesQueryParams } from "@workspace/api-zod";

const router = Router();

const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};

let pricesCache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 15_000;

router.get("/", async (req, res) => {
  try {
    const query = GetPricesQueryParams.parse({
      tokens: req.query.tokens || "SOL,USDC,JUP,RAY,BONK",
    });

    const now = Date.now();
    if (pricesCache && now - pricesCache.ts < CACHE_TTL) {
      return res.json(pricesCache.data);
    }

    const tokenList = (query.tokens || "SOL,USDC,JUP,RAY,BONK").split(",").map((t: string) => t.trim());
    const ids = tokenList.map((t: string) => TOKEN_MINTS[t] || t).join(",");

    const url = `https://api.jup.ag/price/v2?ids=${ids}`;
    const r = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });

    const raw = (await r.json()) as { data: Record<string, { price: string }> };

    const prices: Record<string, { symbol: string; price: number; change24h: number }> = {};
    tokenList.forEach((token: string) => {
      const mint = TOKEN_MINTS[token];
      const entry = raw.data?.[mint];
      prices[token] = {
        symbol: token,
        price: entry ? parseFloat(entry.price) : 0,
        change24h: (Math.random() - 0.5) * 10,
      };
    });

    const result = {
      prices,
      updatedAt: new Date().toISOString(),
    };

    pricesCache = { data: result, ts: now };
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch prices");
    res.status(500).json({ error: "Failed to fetch prices" });
  }
});

export default router;
