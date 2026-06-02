import type { PoolSnapshot } from "./domain.js";

export type PoolIntelligenceContext = {
  degenScore: number;
  socialVelocityScore: number;
  socialVelocityDelta: number;
  whalePressureScore: number;
  whaleFlowBps: number;
  bondingCurveProgressPct: number;
  eventWindowActive: boolean;
  eventName?: string;
  eventBlocksRemaining?: number;
  migrateTarget?: PoolSnapshot["migrateTarget"];
  rugRiskScore: number;
  previousRugsByDev: number;
  holderGini: number;
};

export type TickRangeForecast = {
  lowerBinId: number;
  upperBinId: number;
  centerBinId: number;
  horizonMinutes: number;
  confidence: number;
  predictedMoveBps: number;
};

export type ExecutionAuctionPlan = {
  preferredRoute: "JUPITER" | "DIRECT_POOL" | "JITO";
  candidates: Array<"JUPITER" | "DIRECT_POOL" | "JITO">;
  simulationBudgetMs: number;
};

export type NarrativeCluster = {
  relatedPools: string[];
  score: number;
};

export type PoolIntelligence = {
  tickRange: TickRangeForecast;
  liquidityVacuumScore: number;
  walletFingerprintRisk: number;
  feeCompoundingRatio: number;
  narrativeCluster: NarrativeCluster;
  deadPoolScore: number;
  executionAuction: ExecutionAuctionPlan;
  phantomLiquidityScore: number;
};

export function analyzePoolIntelligence(params: {
  pool: PoolSnapshot;
  previous?: PoolSnapshot;
  universe: PoolSnapshot[];
  context: PoolIntelligenceContext;
}): PoolIntelligence {
  const { pool, previous, universe, context } = params;
  const volumePct = previous ? percentChange(previous.volume24hUsd, pool.volume24hUsd) : 0;
  const tvlPct = previous ? percentChange(previous.tvlUsd, pool.tvlUsd) : 0;
  const feePct = previous ? percentChange(previous.fee24hUsd, pool.fee24hUsd) : 0;
  const feeVelocity = pool.tvlUsd > 0 ? (pool.fee24hUsd / pool.tvlUsd) * 100 : 0;
  const expectedMoveBps = clamp(
    (context.socialVelocityDelta * 14)
      + (volumePct * 1.8)
      + (feePct * 0.8)
      - (context.whalePressureScore * 0.45)
      + (pool.signalSeed === "ENTER" ? 60 : 0)
      - (pool.signalSeed === "AVOID" ? 40 : 0),
    -1_500,
    1_500,
  );
  const horizonMinutes = context.eventWindowActive ? 5 : context.socialVelocityScore >= 70 ? 15 : 30;
  const binSpread = Math.max(3, Math.round(Math.abs(expectedMoveBps) / Math.max(2, pool.binStep * 4)) + (context.eventWindowActive ? 2 : 0));
  const centerShift = Math.round(expectedMoveBps / Math.max(1, pool.binStep * 4));
  const centerBinId = pool.activeBinId + centerShift;
  const tickRange: TickRangeForecast = {
    lowerBinId: Math.max(0, centerBinId - binSpread),
    upperBinId: Math.max(centerBinId + 1, centerBinId + binSpread),
    centerBinId,
    horizonMinutes,
    confidence: clamp(
      0.45
        + Math.min(0.3, context.socialVelocityScore / 400)
        + Math.min(0.15, Math.abs(context.socialVelocityDelta) / 80)
        + Math.min(0.1, feeVelocity / 20),
      0.15,
      0.95,
    ),
    predictedMoveBps: round2(expectedMoveBps),
  };

  const liquidityVacuumScore = clamp(
    previous
      ? Math.max(0,
        (-tvlPct * 0.55)
        + Math.max(0, volumePct) * 0.35
        + Math.max(0, feePct) * 0.25
        + Math.max(0, feeVelocity * 8),
      )
      : 0,
    0,
    100,
  );

  const walletFingerprintRisk = clamp(
    (context.previousRugsByDev * 18)
      + (Math.max(0, 9 - estimateDevWalletAgeDays(pool.createdAt)) * 3)
      + Math.max(0, context.rugRiskScore - 35) * 0.4
      + Math.max(0, (pool.topTenHolderSharePct ?? 0) - 80) * 0.9,
    0,
    100,
  );

  const estimatedExecutionCostUsd = Math.max(2.5, 1.5 + pool.binStep * 0.08 + (pool.tvlUsd < 100_000 ? 1.25 : 0));
  const feeCompoundingRatio = pool.fee24hUsd / estimatedExecutionCostUsd;

  const narrativeCluster = buildNarrativeCluster(pool, universe, context);

  const deadPoolScore = clamp(
    (pool.tvlUsd <= 5_000 ? 35 : 0)
      + (previous ? Math.max(0, percentChange(previous.tvlUsd, pool.tvlUsd) * -0.25) : 0)
      + Math.max(0, pool.volume24hUsd / Math.max(1, pool.tvlUsd) * 55)
      + Math.max(0, estimateDevWalletAgeDays(pool.createdAt) - 1) * 0.7,
    0,
    100,
  );

  const executionAuction = buildExecutionAuction(pool, context, feeCompoundingRatio, liquidityVacuumScore);
  const phantomLiquidityScore = clamp(
    (Math.abs(expectedMoveBps) / 12)
      + Math.max(0, context.whalePressureScore - 45) * 0.8
      + Math.max(0, volumePct) * 0.2
      + (pool.tvlUsd < 250_000 ? 10 : 0)
      + (liquidityVacuumScore > 60 ? 8 : 0),
    0,
    100,
  );

  return {
    tickRange,
    liquidityVacuumScore,
    walletFingerprintRisk,
    feeCompoundingRatio: round2(feeCompoundingRatio),
    narrativeCluster,
    deadPoolScore,
    executionAuction,
    phantomLiquidityScore,
  };
}

function buildNarrativeCluster(pool: PoolSnapshot, universe: PoolSnapshot[], context: PoolIntelligenceContext): NarrativeCluster {
  const tokenKeys = uniqueKeys([pool.tokenX, pool.tokenY]);
  const relatedPools = universe
    .filter((candidate) => candidate.address !== pool.address)
    .filter((candidate) => {
      const candidateKeys = uniqueKeys([candidate.tokenX, candidate.tokenY]);
      return tokenKeys.some((key) => candidateKeys.some((candidateKey) => candidateKey.startsWith(key) || key.startsWith(candidateKey)));
    })
    .filter((candidate) => candidate.socialVelocityScore ?? 0 >= Math.max(35, context.socialVelocityScore - 20))
    .sort((a, b) => (b.socialVelocityScore ?? 0) - (a.socialVelocityScore ?? 0))
    .slice(0, 4)
    .map((candidate) => candidate.address);

  const score = clamp(
    relatedPools.length * 24
      + Math.max(0, context.socialVelocityScore - 40) * 0.5
      + Math.max(0, context.socialVelocityDelta) * 0.75,
    0,
    100,
  );

  return {
    relatedPools,
    score,
  };
}

function buildExecutionAuction(
  pool: PoolSnapshot,
  context: PoolIntelligenceContext,
  feeCompoundingRatio: number,
  liquidityVacuumScore: number,
): ExecutionAuctionPlan {
  const candidates: ExecutionAuctionPlan["candidates"] = [];
  if (context.whalePressureScore >= 70 || liquidityVacuumScore >= 70) {
    candidates.push("JITO");
  }
  if (pool.signalSeed === "ENTER" || context.socialVelocityScore >= 60) {
    candidates.push("JUPITER");
  }
  if (pool.tvlUsd < 250_000 || feeCompoundingRatio >= 20) {
    candidates.push("DIRECT_POOL");
  }
  if (candidates.length === 0) {
    candidates.push("JUPITER", "DIRECT_POOL");
  }

  return {
    preferredRoute: candidates[0] ?? "JUPITER",
    candidates: [...new Set(candidates)],
    simulationBudgetMs: context.eventWindowActive ? 50 : 120,
  };
}

function uniqueKeys(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

function percentChange(previous: number, current: number) {
  if (!Number.isFinite(previous) || previous === 0) return 0;
  return ((current - previous) / previous) * 100;
}

function estimateDevWalletAgeDays(createdAt?: string) {
  if (!createdAt) return 7;
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return 7;
  return Math.max(1, Math.round((Date.now() - timestamp) / 86_400_000));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
