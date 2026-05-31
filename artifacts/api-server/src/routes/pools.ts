import { Router } from "express";
import { GetPoolsQueryParams, GetPoolParams } from "@workspace/api-zod";
import { enrichPool } from "../lib/pools";

const router = Router();

const METEORA_API = "https://dlmm-api.meteora.ag";

type PoolRecord = ReturnType<typeof enrichPool>;
type PoolListPayload = {
  pools: PoolRecord[];
  total: number;
  lastUpdated: string;
};

const poolsCache = new Map<string, { data: PoolListPayload; ts: number }>();
const CACHE_TTL = 60_000;

async function fetchMeteoraPools(limit: number, minTvl: number): Promise<PoolListPayload> {
  const now = Date.now();
  const cacheKey = `${limit}:${minTvl}`;
  const cached = poolsCache.get(cacheKey);
  if (cached && now - cached.ts < CACHE_TTL) {
    return cached.data;
  }

  const url = `${METEORA_API}/pair/all?limit=100&sort_key=liquidity&order_by=desc`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Meteora API error: ${res.status}`);
  const raw = (await res.json()) as unknown[];

  const pools = raw
    .filter((record: any) => Number(record.liquidity ?? 0) >= minTvl)
    .slice(0, limit)
    .map((record: any) => enrichPool(record));

  const payload = {
    pools,
    total: pools.length,
    lastUpdated: new Date().toISOString(),
  };

  poolsCache.set(cacheKey, { data: payload, ts: now });
  return payload;
}

router.get("/", async (req, res) => {
  try {
    const query = GetPoolsQueryParams.parse({
      limit: req.query.limit ? Number(req.query.limit) : 20,
      minTvl: req.query.minTvl ? Number(req.query.minTvl) : 100_000,
      minJupScore: req.query.minJupScore ? Number(req.query.minJupScore) : 0,
    });

    const data = await fetchMeteoraPools(query.limit, query.minTvl);
    const pools = data.pools.filter((pool) => pool.jupScore >= query.minJupScore);

    return res.json({
      ...data,
      pools,
      total: pools.length,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch pools");
    return res.status(500).json({ error: "Failed to fetch pool data" });
  }
});

router.get("/:address", async (req, res) => {
  try {
    const { address } = GetPoolParams.parse({ address: req.params.address });
    const url = `${METEORA_API}/pair/${address}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!r.ok) {
      return res.status(404).json({ error: "Pool not found" });
    }
    const raw = await r.json();
    return res.json(enrichPool(raw as any));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch pool");
    return res.status(500).json({ error: "Failed to fetch pool" });
  }
});

export default router;
