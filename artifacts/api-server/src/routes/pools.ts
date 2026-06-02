import { Router } from "express";
import { GetPoolsQueryParams, GetPoolParams, PoolSignalType, PoolIlRisk } from "@workspace/api-zod";
import { fetchBirdeyeTrendingTokens, getBirdeyeApiKey } from "@workspace/birdeye";
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

async function fetchBirdeyePools(limit: number, minTvl: number): Promise<PoolListPayload> {
  const records = await fetchBirdeyeTrendingTokens({
    limit: Math.max(limit * 2, limit),
    sortBy: "liquidity",
    sortType: "desc",
    interval: "24h",
    apiKey: getBirdeyeApiKey(),
  });

  const pools = records
    .map((record) => birdeyeTokenToPool(record))
    .filter((record) => Number(record.tvl ?? 0) >= minTvl)
    .slice(0, limit)
    .map((record) => enrichPool(record));

  return {
    pools,
    total: pools.length,
    lastUpdated: new Date().toISOString(),
  };
}

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

function birdeyeTokenToPool(record: Record<string, unknown>): Record<string, unknown> {
  const address = String(record.address ?? record.token_address ?? record.mint ?? record.id ?? "");
  const symbol = String(record.symbol ?? record.symbols ?? record.name ?? "").trim();
  const tokenName = symbol ? `${symbol}-USDC` : address.slice(0, 6) || "TOKEN-USDC";
  const liquidity = Number(record.liquidity ?? record.liquidity_usd ?? record.liquidityUsd ?? 0);
  const volume24h = Number(record.volume_24h_usd ?? record.volume24hUsd ?? record.volume ?? 0);
  const price = Number(record.price ?? record.usd_price ?? record.current_price ?? 0);
  const fee24h = Number(record.fees_24h ?? record.fee24h ?? 0) || volume24h * 0.003;
  return {
    address: address || tokenName,
    name: tokenName,
    mint_x: address,
    mint_y: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    liquidity,
    trade_volume_24h: volume24h,
    fees_24h: fee24h,
    current_price: price,
    bin_step: Number(record.bin_step ?? record.binStep ?? 10),
  };
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
    let data = await fetchBirdeyePools(query.limit, query.minTvl).catch(async (birdeyeError) => {
      req.log.warn({ err: birdeyeError }, "Birdeye pool feed unavailable, trying Meteora");
      return null;
    });

    if (!data || data.pools.length === 0) {
      data = await fetchMeteoraPools(query.limit, query.minTvl).catch(async (meteoraError) => {
        req.log.warn({ err: meteoraError }, "Meteora pool feed unavailable, using discovery fallback");
        const fallbackPools = mergeDiscoveredPools([], candidates, discoverySettings.enabledDexes).map((pool) => snapshotToApiPool(pool));
        return {
          pools: fallbackPools,
          total: fallbackPools.length,
          lastUpdated: new Date().toISOString(),
        } satisfies PoolListPayload;
      });
    }
    const discoveredPools = mergeDiscoveredPools(
      data.pools.map((pool) => pool) as any,
      candidates,
      discoverySettings.enabledDexes,
    ).map((pool) => snapshotToApiPool(pool));
    const mergedPools = [...discoveredPools]
      .reduce<PoolRecord[]>((acc, pool) => {
        if (!acc.some((entry) => entry.address === pool.address)) {
          acc.push(pool);
        }
        return acc;
      }, [])
      .filter((pool) => pool.tvl >= query.minTvl && pool.jupScore >= query.minJupScore);
    const pools = mergedPools
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
