import { Router } from "express";
import { GetPoolsQueryParams, GetPoolParams } from "@workspace/api-zod";

const router = Router();

const METEORA_API = "https://dlmm-api.meteora.ag";

let poolsCache: { data: unknown; ts: number } | null = null;
const CACHE_TTL = 60_000;

async function fetchMeteoraPools(limit: number, minTvl: number) {
  const now = Date.now();
  if (poolsCache && now - poolsCache.ts < CACHE_TTL) {
    return poolsCache.data;
  }

  const url = `${METEORA_API}/pair/all?limit=100&sort_key=liquidity&order_by=desc`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) throw new Error(`Meteora API error: ${res.status}`);
  const raw = await res.json() as unknown[];

  const pools = raw
    .filter((p: any) => {
      const tvl = parseFloat(p.liquidity || "0");
      return tvl >= minTvl;
    })
    .slice(0, limit)
    .map((p: any) => enrichPool(p));

  const result = {
    pools,
    total: pools.length,
    lastUpdated: new Date().toISOString(),
  };

  poolsCache = { data: result, ts: now };
  return result;
}

function enrichPool(p: any) {
  const tvl = parseFloat(p.liquidity || "0");
  const volume24h = parseFloat(p.trade_volume_24h || "0");
  const fee24h = parseFloat(p.fees_24h || "0");
  const feeRate = tvl > 0 ? (fee24h / tvl) * 100 : 0;
  const binStep = parseInt(p.bin_step || "1");

  const name = p.name || `${p.mint_x?.slice(0, 4)}/${p.mint_y?.slice(0, 4)}`;
  const tokenX = (p.name || "").split("-")[0] || "TOKEN";
  const tokenY = (p.name || "").split("-")[1] || "USDC";

  const jupScore = computeJupScore(tvl, volume24h, feeRate, binStep);
  const smartMoneyScore = computeSmartMoneyScore(tvl, volume24h);
  const ilRisk = computeIlRisk(binStep, tokenX);
  const signalScore = (jupScore * 0.5 + smartMoneyScore * 0.3 + feeRate * 10 * 0.2);
  const signalType = signalScore >= 65 ? "ENTER" : signalScore >= 45 ? "WATCH" : "AVOID";

  return {
    address: p.address || "",
    name: p.name || name,
    tokenX,
    tokenY,
    tvl,
    volume24h,
    fee24h,
    feeRate: Math.round(feeRate * 100) / 100,
    binStep,
    signalScore: Math.round(signalScore),
    jupScore: Math.round(jupScore),
    smartMoneyScore: Math.round(smartMoneyScore),
    ilRisk,
    signalType,
    currentPrice: parseFloat(p.current_price || "0"),
    activeBinId: parseInt(p.active_id || "0"),
  };
}

function computeJupScore(tvl: number, vol: number, feeRate: number, binStep: number): number {
  let score = 0;
  if (tvl > 5_000_000) score += 30;
  else if (tvl > 1_000_000) score += 20;
  else if (tvl > 500_000) score += 10;
  const volRatio = tvl > 0 ? vol / tvl : 0;
  if (volRatio > 2) score += 30;
  else if (volRatio > 1) score += 20;
  else if (volRatio > 0.5) score += 10;
  if (feeRate > 3) score += 20;
  else if (feeRate > 1) score += 10;
  if (binStep <= 5) score += 20;
  else if (binStep <= 20) score += 10;
  return Math.min(100, score);
}

function computeSmartMoneyScore(tvl: number, vol: number): number {
  let score = 30;
  if (tvl > 2_000_000) score += 30;
  else if (tvl > 500_000) score += 20;
  const ratio = tvl > 0 ? vol / tvl : 0;
  if (ratio > 1.5) score += 25;
  else if (ratio > 0.8) score += 15;
  score += Math.floor(Math.random() * 10);
  return Math.min(100, score);
}

function computeIlRisk(binStep: number, tokenX: string): "LOW" | "MEDIUM" | "HIGH" {
  const stable = ["USDC", "USDT", "USDH", "PAI", "UXD"].some((s) =>
    tokenX.toUpperCase().includes(s)
  );
  if (stable) return "LOW";
  if (binStep <= 5) return "LOW";
  if (binStep <= 25) return "MEDIUM";
  return "HIGH";
}

router.get("/", async (req, res) => {
  try {
    const query = GetPoolsQueryParams.parse({
      limit: req.query.limit ? Number(req.query.limit) : 20,
      minTvl: req.query.minTvl ? Number(req.query.minTvl) : 100000,
      minJupScore: req.query.minJupScore ? Number(req.query.minJupScore) : 0,
    });

    const data = await fetchMeteoraPools(query.limit, query.minTvl);
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Failed to fetch pools");
    res.status(500).json({ error: "Failed to fetch pool data" });
  }
});

router.get("/:address", async (req, res) => {
  try {
    const { address } = GetPoolParams.parse({ address: req.params.address });
    const url = `${METEORA_API}/pair/${address}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!r.ok) {
      return res.status(404).json({ error: "Pool not found" });
    }
    const raw = await r.json();
    res.json(enrichPool(raw));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch pool");
    res.status(500).json({ error: "Failed to fetch pool" });
  }
});

export default router;
