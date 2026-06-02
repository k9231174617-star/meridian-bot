import { Router } from "express";
import { GetPoolsQueryParams, GetPoolParams, PoolSignalType, PoolIlRisk } from "@workspace/api-zod";
import { enrichPool } from "../lib/pools";
import { loadDiscoveryCandidates, loadDiscoverySettings, mergeDiscoveredPools, parseDexList } from "../lib/discovery";
import { resolveStorageDir } from "../lib/bot-status";

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

function snapshotToApiPool(pool: any): PoolRecord {
  return {
    address: pool.address,
    name: pool.name,
    tokenX: pool.tokenX,
    tokenY: pool.tokenY,
    tvl: Number(pool.tvlUsd ?? pool.tvl ?? 0),
    volume24h: Number(pool.volume24hUsd ?? pool.volume24h ?? 0),
    fee24h: Number(pool.fee24hUsd ?? pool.fee24h ?? 0),
    feeRate: Number(pool.feeRatePct ?? pool.feeRate ?? 0),
    binStep: Number(pool.binStep ?? 1),
    signalScore: Number(pool.signalScore ?? 0),
    jupScore: Number(pool.jupScore ?? 0),
    smartMoneyScore: Number(pool.smartMoneyScore ?? 0),
    ilRisk: normalizeIlRisk(pool.ilRisk),
    signalType: normalizeSignalType(pool.signalSeed ?? pool.signalType),
    currentPrice: Number(pool.currentPrice ?? 0),
    activeBinId: Number(pool.activeBinId ?? 0),
    ...(pool.dex ? { dex: pool.dex } : {}),
    ...(pool.discoveryConfidence !== undefined ? { discoveryConfidence: pool.discoveryConfidence } : {}),
    ...(pool.discoverySource ? { discoverySource: pool.discoverySource } : {}),
    ...(pool.discoverySignature ? { discoverySignature: pool.discoverySignature } : {}),
    ...(pool.isDiscoveryCandidate !== undefined ? { isDiscoveryCandidate: pool.isDiscoveryCandidate } : {}),
    ...(typeof pool.tokenSafetyScore === "number" ? { tokenSafetyScore: pool.tokenSafetyScore } : {}),
    ...(typeof pool.rugRiskScore === "number" ? { rugRiskScore: pool.rugRiskScore } : {}),
    ...(typeof pool.degenScore === "number" ? { degenScore: pool.degenScore } : {}),
    ...(typeof pool.holderGini === "number" ? { holderGini: pool.holderGini } : {}),
    ...(typeof pool.devWalletAgeDays === "number" ? { devWalletAgeDays: pool.devWalletAgeDays } : {}),
    ...(typeof pool.previousRugsByDev === "number" ? { previousRugsByDev: pool.previousRugsByDev } : {}),
    ...(typeof pool.contractRiskScore === "number" ? { contractRiskScore: pool.contractRiskScore } : {}),
    ...(typeof pool.bondingCurveProgressPct === "number" ? { bondingCurveProgressPct: pool.bondingCurveProgressPct } : {}),
    ...(pool.migrateTarget ? { migrateTarget: pool.migrateTarget } : {}),
    ...(typeof pool.socialVelocityScore === "number" ? { socialVelocityScore: pool.socialVelocityScore } : {}),
    ...(typeof pool.socialVelocityDelta === "number" ? { socialVelocityDelta: pool.socialVelocityDelta } : {}),
    ...(typeof pool.whaleFlowBps === "number" ? { whaleFlowBps: pool.whaleFlowBps } : {}),
    ...(typeof pool.whalePressureScore === "number" ? { whalePressureScore: pool.whalePressureScore } : {}),
    ...(typeof pool.fdvUsd === "number" ? { fdvUsd: pool.fdvUsd } : {}),
    ...(typeof pool.eventWindowActive === "boolean" ? { eventWindowActive: pool.eventWindowActive } : {}),
    ...(pool.eventName ? { eventName: pool.eventName } : {}),
    ...(typeof pool.eventBlocksRemaining === "number" ? { eventBlocksRemaining: pool.eventBlocksRemaining } : {}),
  } as PoolRecord;
}

function normalizeSignalType(signal: unknown) {
  if (signal === "ENTER" || signal === "WATCH" || signal === "AVOID") return signal;
  return PoolSignalType.WATCH;
}

function normalizeIlRisk(risk: unknown) {
  if (risk === PoolIlRisk.LOW || risk === PoolIlRisk.MEDIUM || risk === PoolIlRisk.HIGH) return risk;
  return PoolIlRisk.MEDIUM;
}

router.get("/", async (req, res) => {
  try {
    const query = GetPoolsQueryParams.parse({
      limit: req.query.limit ? Number(req.query.limit) : 20,
      minTvl: req.query.minTvl ? Number(req.query.minTvl) : 100_000,
      minJupScore: req.query.minJupScore ? Number(req.query.minJupScore) : 0,
    });

    const storageDir = resolveStorageDir();
    const discoverySettings = await loadDiscoverySettings(storageDir, parseDexList(process.env.BOT_ENABLED_DEXES));
    const candidates = await loadDiscoveryCandidates(storageDir, 100);
    const data = await fetchMeteoraPools(query.limit, query.minTvl).catch(async (error) => {
      req.log.warn({ err: error }, "Meteora pool feed unavailable, using discovery fallback");
      const fallbackPools = mergeDiscoveredPools([], candidates, discoverySettings.enabledDexes).map((pool) => snapshotToApiPool(pool));
      return {
        pools: fallbackPools,
        total: fallbackPools.length,
        lastUpdated: new Date().toISOString(),
      } satisfies PoolListPayload;
    });
    const discoveredPools = mergeDiscoveredPools(
      data.pools.map((pool) => ({ ...pool, dex: "meteora" as const })) as any,
      candidates,
      discoverySettings.enabledDexes,
    ).map((pool) => snapshotToApiPool(pool));
    const pools = discoveredPools
      .filter((pool) => pool.tvl >= query.minTvl && pool.jupScore >= query.minJupScore)
      .slice(0, query.limit);

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
