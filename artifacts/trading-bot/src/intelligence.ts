import { createHash } from "node:crypto";
import type { MarketSnapshot, PoolSnapshot } from "./domain.js";

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
  sampleCount: number;
  regressionR2: number;
};

export type LiquidityVacuumEvidence = {
  eligible: boolean;
  tvlDrawdownPct: number;
  volumeRetentionPct: number;
  feeRateExpansionPct: number;
  windowSize: number;
};

export type WalletFingerprintEvidence = {
  eligible: boolean;
  fingerprintId?: string;
  creatorAddress?: string;
  priorRugsByDev: number;
  developerAgeDays: number;
  triggerReason?: "prior-rugs" | "contract-risk" | "authorities" | "age";
};

export type FeeCompoundingEvidence = {
  eligible: boolean;
  ratio: number;
  executionCostUsd: number;
  threshold: number;
};

export type NarrativeCluster = {
  relatedPools: string[];
  overlapRatios: Record<string, number>;
  eligible: boolean;
  score: number;
};

export type DeadPoolEvidence = {
  eligible: boolean;
  ageHours: number;
  tvlUsd: number;
  volumeToTvlRatio: number;
  feeRatePct: number;
};

export type ExecutionAuctionPlan = {
  preferredRoute: "JUPITER" | "DIRECT_POOL" | "JITO";
  candidates: Array<"JUPITER" | "DIRECT_POOL" | "JITO">;
  simulationBudgetMs: number;
  rationale: string[];
};

export type PhantomLiquidityEvidence = {
  eligible: boolean;
  mevAttackCount: number;
  honeypotSimulationBps: number;
  trapBudgetUsd: number;
};

export type PoolIntelligence = {
  tickRange: TickRangeForecast | null;
  liquidityVacuum: LiquidityVacuumEvidence;
  walletFingerprint: WalletFingerprintEvidence;
  feeCompounding: FeeCompoundingEvidence;
  narrativeCluster: NarrativeCluster;
  deadPool: DeadPoolEvidence;
  executionAuction: ExecutionAuctionPlan;
  phantomLiquidity: PhantomLiquidityEvidence;
};

export function analyzePoolIntelligence(params: {
  pool: PoolSnapshot;
  previous?: PoolSnapshot;
  previousCapturedAt?: string;
  universe: PoolSnapshot[];
  history?: MarketSnapshot[];
  capturedAt: string;
  context: PoolIntelligenceContext;
}): PoolIntelligence {
  const { pool, previous, previousCapturedAt, universe, history = [], context, capturedAt } = params;
  const poolHistory = collectPoolHistory(pool.address, history, pool, previous, capturedAt, previousCapturedAt);
  const tickRange = buildTickRangeForecast(pool, poolHistory, context);
  const liquidityVacuum = buildLiquidityVacuum(pool, previous, poolHistory);
  const walletFingerprint = buildWalletFingerprint(pool, context);
  const feeCompounding = buildFeeCompounding(pool);
  const narrativeCluster = buildNarrativeCluster(pool, universe);
  const deadPool = buildDeadPoolEvidence(pool, previous);
  const executionAuction = buildExecutionAuction(pool, liquidityVacuum, feeCompounding, context);
  const phantomLiquidity = buildPhantomLiquidityEvidence(pool, executionAuction);

  return {
    tickRange,
    liquidityVacuum,
    walletFingerprint,
    feeCompounding,
    narrativeCluster,
    deadPool,
    executionAuction,
    phantomLiquidity,
  };
}

function buildTickRangeForecast(
  pool: PoolSnapshot,
  poolHistory: Array<{ capturedAt: string; pool: PoolSnapshot }>,
  context: PoolIntelligenceContext,
): TickRangeForecast | null {
  const points = poolHistory
    .map((entry) => ({
      time: new Date(entry.capturedAt).getTime(),
      price: entry.pool.currentPrice,
      binId: entry.pool.activeBinId,
    }))
    .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0);

  if (points.length < 3) return null;

  const fit = linearRegression(points.map((point) => point.time), points.map((point) => point.price));
  if (!fit) return null;
  const firstPoint = points[0]!;
  const lastPoint = points[points.length - 1]!;
  const priceSpanPct = firstPoint.price > 0 ? Math.abs((lastPoint.price - firstPoint.price) / firstPoint.price) : 0;
  const trendDirection = Math.sign(lastPoint.price - firstPoint.price);
  const directionSupport =
    points.slice(1).reduce((support, point, index) => {
      const delta = point.price - points[index]!.price;
      if (delta === 0) return support;
      return support + (Math.sign(delta) === trendDirection ? 1 : 0);
    }, 0) / Math.max(1, points.length - 1);
  const strongTrend = points.length >= 4 && priceSpanPct >= 0.08 && directionSupport >= 0.6;
  if (fit.r2 < 0.55 && !strongTrend) return null;

  const horizonMinutes = context.eventWindowActive ? 5 : fit.slope > 0 ? 15 : 30;
  const horizonMs = horizonMinutes * 60_000;
  const forecastPrice = Math.max(0, fit.intercept + fit.slope * (lastPoint.time + horizonMs));
  const predictedMoveBps = pool.currentPrice > 0 ? round2(((forecastPrice - pool.currentPrice) / pool.currentPrice) * 10_000) : 0;
  const centerShift = Math.round(predictedMoveBps / Math.max(1, pool.binStep * 4));
  const residualStd = fit.residualStdDev;
  const bandWidth = Math.max(2, Math.round(Math.max(1, residualStd / Math.max(pool.currentPrice, 0.000001)) * 10_000 / Math.max(1, pool.binStep * 4)));
  const centerBinId = pool.activeBinId + centerShift;

  return {
    lowerBinId: Math.max(0, centerBinId - bandWidth),
    upperBinId: Math.max(centerBinId + 1, centerBinId + bandWidth),
    centerBinId,
    horizonMinutes,
    confidence: clamp(Math.max(fit.r2, priceSpanPct * directionSupport) * Math.min(1, points.length / 5), 0.2, 0.98),
    predictedMoveBps,
    sampleCount: points.length,
    regressionR2: round2(fit.r2),
  };
}

function buildLiquidityVacuum(
  pool: PoolSnapshot,
  previous: PoolSnapshot | undefined,
  poolHistory: Array<{ capturedAt: string; pool: PoolSnapshot }>,
): LiquidityVacuumEvidence {
  const window = poolHistory.slice(-5).map((entry) => entry.pool);
  const baselineTvl = median(window.slice(0, Math.max(1, window.length - 1)).map((item) => item.tvlUsd));
  const baselineVolume = median(window.slice(0, Math.max(1, window.length - 1)).map((item) => item.volume24hUsd));
  const baselineFeeRate = median(window.slice(0, Math.max(1, window.length - 1)).map((item) => item.feeRatePct));
  const tvlDrawdownPct = baselineTvl > 0 ? clamp(((baselineTvl - pool.tvlUsd) / baselineTvl) * 100, 0, 100) : 0;
  const volumeRetentionPct = baselineVolume > 0 ? clamp((pool.volume24hUsd / baselineVolume) * 100, 0, 100) : 0;
  const feeRateExpansionPct = baselineFeeRate > 0 ? clamp(((pool.feeRatePct - baselineFeeRate) / baselineFeeRate) * 100, -100, 10_000) : 0;
  const eligible = Boolean(
    previous &&
      tvlDrawdownPct >= 20 &&
      volumeRetentionPct >= 90 &&
      feeRateExpansionPct >= 15,
  );

  return {
    eligible,
    tvlDrawdownPct: round2(tvlDrawdownPct),
    volumeRetentionPct: round2(volumeRetentionPct),
    feeRateExpansionPct: round2(feeRateExpansionPct),
    windowSize: window.length,
  };
}

function buildWalletFingerprint(pool: PoolSnapshot, context: PoolIntelligenceContext): WalletFingerprintEvidence {
  const creatorAddress = pool.creatorAddress?.trim();
  const developerAgeDays = Number.isFinite(pool.devWalletAgeDays) ? Math.max(1, Math.round(pool.devWalletAgeDays ?? 0)) : 7;
  const fingerprintId = creatorAddress ? createHash("sha256").update(`${creatorAddress}:${pool.tokenX}:${pool.tokenY}`).digest("hex").slice(0, 16) : undefined;
  const triggerReason =
    pool.previousRugsByDev !== undefined && pool.previousRugsByDev >= 3
      ? "prior-rugs"
      : (pool.contractRiskScore ?? context.rugRiskScore) >= 80
        ? "contract-risk"
        : pool.mintAuthorityRevoked === false || pool.freezeAuthorityRevoked === false || pool.liquidityLocked === false
          ? "authorities"
          : developerAgeDays <= 7
            ? "age"
            : undefined;

  return {
    eligible: Boolean(creatorAddress && triggerReason),
    fingerprintId,
    creatorAddress,
    priorRugsByDev: pool.previousRugsByDev ?? context.previousRugsByDev,
    developerAgeDays,
    triggerReason,
  };
}

function buildFeeCompounding(pool: PoolSnapshot): FeeCompoundingEvidence {
  const executionCostUsd = round2(Math.max(2.5, 1.25 + pool.binStep * 0.06 + (pool.tvlUsd < 100_000 ? 1.5 : 0)));
  const ratio = executionCostUsd > 0 ? pool.fee24hUsd / executionCostUsd : 0;
  const threshold = 10;
  return {
    eligible: pool.tvlUsd >= 25_000 && ratio >= threshold,
    ratio: round2(ratio),
    executionCostUsd,
    threshold,
  };
}

function buildNarrativeCluster(pool: PoolSnapshot, universe: PoolSnapshot[]): NarrativeCluster {
  const currentWallets = new Set((pool.topHolderWallets ?? []).map((value) => value.trim()).filter(Boolean));
  if (currentWallets.size === 0) {
    return { relatedPools: [], overlapRatios: {}, eligible: false, score: 0 };
  }

  const relatedPools = universe
    .filter((candidate) => candidate.address !== pool.address)
    .map((candidate) => {
      const wallets = new Set((candidate.topHolderWallets ?? []).map((value) => value.trim()).filter(Boolean));
      if (wallets.size === 0) return null;
      const shared = intersectionSize(currentWallets, wallets);
      const union = new Set([...currentWallets, ...wallets]).size;
      const overlapRatio = union > 0 ? shared / union : 0;
      if (shared >= 3 && overlapRatio >= 0.2) {
        return {
          address: candidate.address,
          overlapRatio,
        };
      }
      return null;
    })
    .filter((entry): entry is { address: string; overlapRatio: number } => Boolean(entry))
    .sort((a, b) => b.overlapRatio - a.overlapRatio)
    .slice(0, 4);

  const overlapRatios = Object.fromEntries(relatedPools.map((entry) => [entry.address, round2(entry.overlapRatio)]));
  const score = round2(relatedPools.reduce((sum, entry) => sum + entry.overlapRatio, 0) * 100);

  return {
    relatedPools: relatedPools.map((entry) => entry.address),
    overlapRatios,
    eligible: relatedPools.length >= 1,
    score,
  };
}

function buildDeadPoolEvidence(pool: PoolSnapshot, previous: PoolSnapshot | undefined): DeadPoolEvidence {
  const ageHours = estimatePoolAgeHours(pool.createdAt);
  const volumeToTvlRatio = pool.tvlUsd > 0 ? pool.volume24hUsd / pool.tvlUsd : 0;
  return {
    eligible: pool.tvlUsd < 5_000 && ageHours >= 24 && volumeToTvlRatio >= 0.2 && (previous ? previous.tvlUsd >= pool.tvlUsd : true),
    ageHours: round2(ageHours),
    tvlUsd: pool.tvlUsd,
    volumeToTvlRatio: round2(volumeToTvlRatio),
    feeRatePct: round2(pool.feeRatePct),
  };
}

function buildExecutionAuction(
  pool: PoolSnapshot,
  liquidityVacuum: LiquidityVacuumEvidence,
  feeCompounding: FeeCompoundingEvidence,
  context: PoolIntelligenceContext,
): ExecutionAuctionPlan {
  const candidates: Array<"JUPITER" | "DIRECT_POOL" | "JITO"> = [];
  const rationale: string[] = [];

  if (pool.mevAttackCount && pool.mevAttackCount > 0) {
    candidates.push("JITO");
    rationale.push(`Observed ${pool.mevAttackCount} MEV attacks`);
  }
  if (pool.honeypotSimulationBps && pool.honeypotSimulationBps >= 150) {
    if (!candidates.includes("JITO")) candidates.push("JITO");
    rationale.push(`Honeypot simulation ${pool.honeypotSimulationBps.toFixed(0)} bps`);
  }
  if (feeCompounding.eligible || liquidityVacuum.eligible || pool.tvlUsd < 250_000) {
    candidates.push("DIRECT_POOL");
    rationale.push("Direct pool execution minimizes routing overhead");
  }
  if (context.eventWindowActive || context.socialVelocityScore >= 60 || pool.signalSeed === "ENTER") {
    candidates.push("JUPITER");
    rationale.push("Aggregator route offers best split-route pricing");
  }

  if (candidates.length === 0) {
    candidates.push("JUPITER", "DIRECT_POOL");
  }

  const ordered = unique(candidates);
  const preferredRoute = ordered[0] ?? "JUPITER";
  const simulationBudgetMs = pool.mevAttackCount && pool.mevAttackCount > 0 ? 50 : context.eventWindowActive ? 75 : 120;

  return {
    preferredRoute,
    candidates: ordered,
    simulationBudgetMs,
    rationale,
  };
}

function buildPhantomLiquidityEvidence(pool: PoolSnapshot, executionAuction: ExecutionAuctionPlan): PhantomLiquidityEvidence {
  const mevAttackCount = Math.max(0, Math.round(pool.mevAttackCount ?? 0));
  const honeypotSimulationBps = Math.max(0, round2(pool.honeypotSimulationBps ?? 0));
  const eligible = mevAttackCount > 0 || honeypotSimulationBps >= 150;

  return {
    eligible,
    mevAttackCount,
    honeypotSimulationBps,
    trapBudgetUsd: round2(Math.min(pool.tvlUsd * 0.01, 25)),
  };
}

function collectPoolHistory(
  poolAddress: string,
  history: MarketSnapshot[],
  pool: PoolSnapshot,
  previous?: PoolSnapshot,
  currentCapturedAt?: string,
  previousCapturedAt?: string,
): Array<{ capturedAt: string; pool: PoolSnapshot }> {
  const rows = history
    .flatMap((snapshot) => {
      const current = snapshot.pools.find((entry) => entry.address === poolAddress);
      return current ? [{ capturedAt: snapshot.capturedAt, pool: current }] : [];
    })
    .filter((entry) => Boolean(entry.pool.currentPrice) && entry.pool.currentPrice > 0);

  if (previous && !rows.some((entry) => entry.pool.address === previous.address && entry.capturedAt === (previousCapturedAt ?? previous.createdAt ?? ""))) {
    rows.push({
      capturedAt: previousCapturedAt ?? previous.createdAt ?? new Date().toISOString(),
      pool: previous,
    });
  }

  if (!rows.some((entry) => entry.pool.address === pool.address && entry.capturedAt === pool.createdAt)) {
    rows.push({
      capturedAt: currentCapturedAt ?? pool.createdAt ?? new Date().toISOString(),
      pool,
    });
  }

  return rows
    .filter((entry) => Number.isFinite(new Date(entry.capturedAt).getTime()))
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());
}

function linearRegression(xs: number[], ys: number[]) {
  if (xs.length !== ys.length || xs.length < 2) return null;

  const n = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < n; index += 1) {
    numerator += (xs[index]! - meanX) * (ys[index]! - meanY);
    denominator += (xs[index]! - meanX) ** 2;
  }

  if (denominator === 0) return null;

  const slope = numerator / denominator;
  const intercept = meanY - slope * meanX;
  const predicted = xs.map((x) => intercept + slope * x);
  const residuals = ys.map((y, index) => y - predicted[index]!);
  const ssRes = residuals.reduce((sum, value) => sum + value ** 2, 0);
  const ssTot = ys.reduce((sum, value) => sum + (value - meanY) ** 2, 0);
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  const residualStdDev = Math.sqrt(ssRes / Math.max(1, n - 2));

  return {
    slope,
    intercept,
    r2: clamp(r2, 0, 1),
    residualStdDev,
  };
}

function estimatePoolAgeHours(createdAt?: string) {
  if (!createdAt) return 0;
  const time = new Date(createdAt).getTime();
  if (!Number.isFinite(time)) return 0;
  return Math.max(0, (Date.now() - time) / 3_600_000);
}

function intersectionSize(a: Set<string>, b: Set<string>) {
  let count = 0;
  for (const value of a) {
    if (b.has(value)) count += 1;
  }
  return count;
}

function unique(values: Array<"JUPITER" | "DIRECT_POOL" | "JITO">) {
  return [...new Set(values)];
}

function median(values: number[]) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1]! + sorted[middle]!) / 2;
  }
  return sorted[middle]!;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
