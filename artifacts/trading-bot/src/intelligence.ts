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
  tokenProfile: {
    category: "memecoin" | "stable" | "bluechip" | "unknown";
    confidence: number;
    downsideMultiplier: number;
    upsideMultiplier: number;
    tailMultiplier: number;
  };
};

export type FeeVelocityEvidence = {
  eligible: boolean;
  acceleration: number;
  quality: number;
  feeEfficiency: number;
  tvlHealth: number;
  volume5mUsd: number;
  volume1hUsd: number;
  feeCollected5mUsd: number;
  directionBias: number;
  sampleCount: number;
  confidence: number;
};

export type SmartMoneyShadowEvidence = {
  eligible: boolean;
  clusterScore: number;
  smartWallets: string[];
  relatedPools: string[];
  lagSeconds: number;
  confidence: number;
};

export type RugDnaEvidence = {
  eligible: boolean;
  dnaScore: number;
  creatorRisk: number;
  distributionRisk: number;
  socialRisk: number;
  similarityCount: number;
  pattern: "high-risk" | "mixed" | "clean";
};

export type CrossDexArbitrageEvidence = {
  eligible: boolean;
  spreadPct: number;
  bestDex?: PoolSnapshot["dex"];
  peerDex?: PoolSnapshot["dex"];
  peerPoolAddress?: string;
  direction: "buy-on-peer" | "buy-on-current" | "neutral";
  confidence: number;
};

export type PumpfunGraduateEvidence = {
  eligible: boolean;
  progressPct: number;
  velocityPct: number;
  pattern: "bullish" | "bearish" | "mixed";
  timeToGraduateMinutes: number;
  confidence: number;
  recommendedAction: "ADD_LIQUIDITY" | "REMOVE_LIQUIDITY" | "WAIT";
};

export type LiquidityTrapEvidence = {
  eligible: boolean;
  trend: "pumping" | "dumping" | "choppy";
  centerBinId: number;
  lowerBinId: number;
  upperBinId: number;
  trapBias: "below" | "above";
  confidence: number;
};

export type LiquidityVacuumEvidence = {
  eligible: boolean;
  tvlDrawdownPct: number;
  volumeRetentionPct: number;
  feeRateExpansionPct: number;
  priceAdjustedDrawdownPct: number;
  exitEligible: boolean;
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
  feeVelocity: FeeVelocityEvidence;
  smartMoneyShadow: SmartMoneyShadowEvidence;
  rugDna: RugDnaEvidence;
  crossDexArbitrage: CrossDexArbitrageEvidence;
  pumpfunGraduate: PumpfunGraduateEvidence;
  liquidityTrap: LiquidityTrapEvidence;
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
  const feeVelocity = buildFeeVelocityEvidence(pool, poolHistory);
  const smartMoneyShadow = buildSmartMoneyShadow(pool, previous, universe, poolHistory);
  const rugDna = buildRugDnaEvidence(pool, previous, universe, context);
  const crossDexArbitrage = buildCrossDexArbitrageEvidence(pool, universe);
  const pumpfunGraduate = buildPumpfunGraduateEvidence(pool, poolHistory, feeVelocity);
  const liquidityTrap = buildLiquidityTrapEvidence(pool, poolHistory, feeVelocity, smartMoneyShadow);
  const tickRange = buildTickRangeForecast(pool, poolHistory, context, feeVelocity);
  const liquidityVacuum = buildLiquidityVacuum(pool, previous, poolHistory);
  const walletFingerprint = buildWalletFingerprint(pool, context);
  const feeCompounding = buildFeeCompounding(pool);
  const narrativeCluster = buildNarrativeCluster(pool, universe);
  const deadPool = buildDeadPoolEvidence(pool, previous);
  const executionAuction = buildExecutionAuction(pool, liquidityVacuum, feeCompounding, context);
  const phantomLiquidity = buildPhantomLiquidityEvidence(pool, executionAuction);

  return {
    tickRange,
    feeVelocity,
    smartMoneyShadow,
    rugDna,
    crossDexArbitrage,
    pumpfunGraduate,
    liquidityTrap,
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
  feeVelocity: FeeVelocityEvidence,
): TickRangeForecast | null {
  const points = dedupeTrendPoints(
    poolHistory
      .map((entry) => ({
        time: new Date(entry.capturedAt).getTime(),
        price: entry.pool.currentPrice,
        binId: entry.pool.activeBinId,
      }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.price) && point.price > 0),
  );

  if (points.length < 3) return null;

  const priceFit = linearRegression(points.map((point) => point.time), points.map((point) => point.price));
  const binFit = linearRegression(points.map((point) => point.time), points.map((point) => point.binId));
  if (!priceFit && !binFit) return null;
  const firstPoint = points[0]!;
  const lastPoint = points[points.length - 1]!;
  const priceSpanPct = firstPoint.price > 0 ? Math.abs((lastPoint.price - firstPoint.price) / firstPoint.price) : 0;
  const trendDirection = Math.sign(lastPoint.price - firstPoint.price);
  const priceDirectionSupport = computeDirectionSupport(points.map((point) => point.price), trendDirection);
  const binDirectionSupport = computeDirectionSupport(points.map((point) => point.binId), Math.sign(lastPoint.binId - firstPoint.binId));
  const directionSupport = clamp((priceDirectionSupport + binDirectionSupport) / 2, 0, 1);
  const strongTrend = points.length >= 4 && priceSpanPct >= 0.08 && directionSupport >= 0.6;
  const priceR2 = priceFit?.r2 ?? 0;
  const binR2 = binFit?.r2 ?? 0;
  if (Math.max(priceR2, binR2) < 0.45 && !strongTrend) return null;

  const horizonMinutes = context.eventWindowActive || feeVelocity.acceleration >= 2.5 ? 5 : (priceFit?.slope ?? 0) > 0 || (binFit?.slope ?? 0) > 0 ? 15 : 30;
  const horizonMs = horizonMinutes * 60_000;
  const priceSlope = priceFit?.slope ?? 0;
  const priceIntercept = priceFit?.intercept ?? lastPoint.price;
  const binSlope = binFit?.slope ?? 0;
  const binIntercept = binFit?.intercept ?? lastPoint.binId;
  const forecastPrice = Math.max(0, priceIntercept + priceSlope * (lastPoint.time + horizonMs));
  const predictedMoveBps = pool.currentPrice > 0 ? round2(((forecastPrice - pool.currentPrice) / pool.currentPrice) * 10_000) : 0;
  const centerShift = Math.round(predictedMoveBps / Math.max(1, pool.binStep * 4));
  const forecastBinFromTrend = Math.round(binIntercept + binSlope * (lastPoint.time + horizonMs));
  const priceBandWidth = Math.max(2, Math.round(Math.max(1, (priceFit?.residualStdDev ?? 0) / Math.max(pool.currentPrice, 0.000001)) * 10_000 / Math.max(1, pool.binStep * 4)));
  const binBandWidth = Math.max(2, Math.round(Math.max(1, binFit ? binFit.residualStdDev : 0) * 0.65));
  const volatilityBandWidth = Math.max(2, Math.round(averageAbsDelta(points.map((point) => point.binId)) * 1.4 + averageFlipPenalty(points.map((point) => point.binId)) * 3));
  const tokenProfile = classifyTokenProfile(pool);
  const tailMultiplier = Math.max(1.1, 1 + (1 - clamp((priceR2 + binR2) / 2, 0, 1)) * 1.25 + (1 - tokenProfile.confidence) * 0.35);
  const baseBandWidth = Math.max(priceBandWidth, binBandWidth, volatilityBandWidth, 2);
  const lowerBandWidth = Math.max(2, Math.round(baseBandWidth * tokenProfile.downsideMultiplier * tailMultiplier));
  const upperBandWidth = Math.max(2, Math.round(baseBandWidth * tokenProfile.upsideMultiplier * tailMultiplier));
  const confidence = clamp(
    ((priceR2 + binR2) / 2) * 0.5 +
      directionSupport * 0.25 +
      Math.min(1, points.length / 6) * 0.1 +
      feeVelocity.quality * 0.15,
    0.18,
    0.98,
  );
  const blendedCenter = Math.round((pool.activeBinId + centerShift + forecastBinFromTrend) / 3);

  return {
    lowerBinId: Math.max(0, blendedCenter - lowerBandWidth),
    upperBinId: Math.max(blendedCenter + 1, blendedCenter + upperBandWidth),
    centerBinId: blendedCenter,
    horizonMinutes,
    confidence,
    predictedMoveBps,
    sampleCount: points.length,
    regressionR2: round2(Math.max(priceR2, binR2)),
    tokenProfile,
  };
}

function buildFeeVelocityEvidence(
  pool: PoolSnapshot,
  poolHistory: Array<{ capturedAt: string; pool: PoolSnapshot }>,
): FeeVelocityEvidence {
  const points = poolHistory
    .map((entry) => ({
      time: new Date(entry.capturedAt).getTime(),
      pool: entry.pool,
    }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => a.time - b.time);

  const current = points[points.length - 1]?.pool ?? pool;
  const nowTime = points[points.length - 1]?.time ?? new Date().getTime();
  const fiveMinutesAgo = samplePointAtOrBefore(points, nowTime - 5 * 60_000) ?? points[0]?.pool ?? pool;
  const oneHourAgo = samplePointAtOrBefore(points, nowTime - 60 * 60_000) ?? points[0]?.pool ?? pool;

  const volume5mUsd = Math.max(0, current.volume24hUsd - fiveMinutesAgo.volume24hUsd);
  const volume1hUsd = Math.max(0, current.volume24hUsd - oneHourAgo.volume24hUsd);
  const feeCollected5mUsd = Math.max(0, current.fee24hUsd - fiveMinutesAgo.fee24hUsd);
  const avg5mFrom1h = volume1hUsd > 0 ? volume1hUsd / 12 : 0;
  const acceleration = avg5mFrom1h > 0 ? volume5mUsd / avg5mFrom1h : volume5mUsd > 0 ? 999 : 0;
  const priceTrend = safeTrend(current.currentPrice, fiveMinutesAgo.currentPrice);
  const binTrend = safeTrend(current.activeBinId, fiveMinutesAgo.activeBinId);
  const oscillationPenalty = clamp(countDirectionFlips(points.map((entry) => entry.pool.currentPrice)) / Math.max(1, points.length - 2), 0, 1);
  const directionBias = clamp(0.5 + priceTrend * 0.55 + binTrend * 0.35 - oscillationPenalty * 0.15, 0, 1);
  const tvlHealth = fiveMinutesAgo.tvlUsd > 0 ? clamp(current.tvlUsd / fiveMinutesAgo.tvlUsd, 0, 3) : 1;
  const feeEfficiency = current.tvlUsd > 0 ? feeCollected5mUsd / current.tvlUsd : 0;
  const sampleCount = points.filter((entry) => entry.time >= nowTime - 60 * 60_000).length;
  const confidence = clamp(
    Math.min(1, sampleCount / 8) * 0.45 +
      Math.min(1, acceleration / 4) * 0.2 +
      directionBias * 0.2 +
      Math.min(1, feeEfficiency / 0.001) * 0.15,
    0.15,
    0.98,
  );
  const eligible = acceleration > 1.5 && directionBias > 0.55 && feeEfficiency >= 0.0005 && tvlHealth > 0.85;

  return {
    eligible,
    acceleration: round2(acceleration),
    quality: round2(directionBias),
    feeEfficiency: round2(feeEfficiency),
    tvlHealth: round2(tvlHealth),
    volume5mUsd: round2(volume5mUsd),
    volume1hUsd: round2(volume1hUsd),
    feeCollected5mUsd: round2(feeCollected5mUsd),
    directionBias: round2(directionBias),
    sampleCount,
    confidence: round2(confidence),
  };
}

function buildSmartMoneyShadow(
  pool: PoolSnapshot,
  previous: PoolSnapshot | undefined,
  universe: PoolSnapshot[],
  poolHistory: Array<{ capturedAt: string; pool: PoolSnapshot }>,
): SmartMoneyShadowEvidence {
  const currentWallets = uniqueWallets(pool.topHolderWallets ?? []);
  if (currentWallets.length === 0) {
    return { eligible: false, clusterScore: 0, smartWallets: [], relatedPools: [], lagSeconds: 0, confidence: 0 };
  }

  const related = universe
    .filter((candidate) => candidate.address !== pool.address)
    .map((candidate) => {
      const wallets = uniqueWallets(candidate.topHolderWallets ?? []);
      if (wallets.length === 0) return null;
      const overlap = intersectionCount(currentWallets, wallets);
      const sameCreator = Boolean(pool.creatorAddress && candidate.creatorAddress && pool.creatorAddress === candidate.creatorAddress);
      const score = overlap * 12 + (sameCreator ? 16 : 0) + (candidate.smartMoneyScore ?? 0) * 0.15;
      if (overlap >= 2 || sameCreator) {
        return {
          address: candidate.address,
          score,
          wallets,
        };
      }
      return null;
    })
    .filter((entry): entry is { address: string; score: number; wallets: string[] } => Boolean(entry))
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);

  const smartWallets = uniqueWallets(
    related.flatMap((entry) => entry.wallets.filter((wallet) => currentWallets.includes(wallet))),
  );
  const recentHistory = poolHistory.slice(-4);
  const lagSeconds = recentHistory.length >= 2
    ? Math.max(5, Math.round((new Date(recentHistory.at(-1)!.capturedAt).getTime() - new Date(recentHistory[0]!.capturedAt).getTime()) / 1_000 / Math.max(1, recentHistory.length - 1)))
    : 10;
  const clusterScore = clamp(
    (pool.smartMoneyScore ?? 0) * 0.65 +
      related.reduce((sum, entry) => sum + entry.score, 0) +
      Math.min(25, smartWallets.length * 6) +
      (previous ? Math.max(0, ((pool.volume24hUsd - previous.volume24hUsd) / Math.max(previous.volume24hUsd, 1)) * 10) : 0),
    0,
    100,
  );
  const confidence = clamp(0.45 + clusterScore / 160, 0.2, 0.98);

  return {
    eligible: smartWallets.length >= 3 || clusterScore >= 55,
    clusterScore: round2(clusterScore),
    smartWallets: smartWallets.slice(0, 8),
    relatedPools: related.map((entry) => entry.address),
    lagSeconds,
    confidence: round2(confidence),
  };
}

function buildRugDnaEvidence(
  pool: PoolSnapshot,
  previous: PoolSnapshot | undefined,
  universe: PoolSnapshot[],
  context: PoolIntelligenceContext,
): RugDnaEvidence {
  const creatorRisk = clamp(
    (pool.previousRugsByDev ?? context.previousRugsByDev) * 12 +
      (pool.mintAuthorityRevoked === false ? 28 : 0) +
      (pool.freezeAuthorityRevoked === false ? 18 : 0) +
      (pool.liquidityLocked === false ? 16 : 0),
    0,
    100,
  );
  const concentration = Math.max(pool.topHolderSharePct ?? 0, pool.topTenHolderSharePct ?? 0);
  const distributionRisk = clamp(concentration * 0.75 + (pool.holderGini ?? context.holderGini) * 45, 0, 100);
  const socialRisk = clamp((pool.socialVelocityScore ?? context.socialVelocityScore) < 40 ? 30 : 0, 0, 100);
  const similarityCount = universe.filter((candidate) => candidate.address !== pool.address && candidate.creatorAddress && candidate.creatorAddress === pool.creatorAddress).length;
  const dnaScore = clamp(
    creatorRisk * 0.38 +
      distributionRisk * 0.32 +
      socialRisk * 0.12 +
      Math.min(20, similarityCount * 6) +
      (previous && previous.tvlUsd > pool.tvlUsd ? 8 : 0),
    0,
    100,
  );

  return {
    eligible: dnaScore >= 55,
    dnaScore: round2(dnaScore),
    creatorRisk: round2(creatorRisk),
    distributionRisk: round2(distributionRisk),
    socialRisk: round2(socialRisk),
    similarityCount,
    pattern: dnaScore >= 75 ? "high-risk" : dnaScore >= 55 ? "mixed" : "clean",
  };
}

function buildCrossDexArbitrageEvidence(pool: PoolSnapshot, universe: PoolSnapshot[]): CrossDexArbitrageEvidence {
  const pairKey = poolPairKey(pool);
  const peers = universe.filter((candidate) => candidate.address !== pool.address && poolPairKey(candidate) === pairKey && candidate.dex && pool.dex && candidate.dex !== pool.dex && candidate.currentPrice > 0 && pool.currentPrice > 0);
  if (peers.length === 0) {
    return { eligible: false, spreadPct: 0, direction: "neutral", confidence: 0 };
  }

  const ordered = [...peers, pool].sort((a, b) => a.currentPrice - b.currentPrice);
  const low = ordered[0]!;
  const high = ordered[ordered.length - 1]!;
  const spreadPct = low.currentPrice > 0 ? ((high.currentPrice - low.currentPrice) / low.currentPrice) * 100 : 0;
  const bestDex = low.currentPrice <= pool.currentPrice ? low.dex : high.dex;
  const peerDex = low.address === pool.address ? high.dex : low.dex;
  const direction = high.address === pool.address ? "buy-on-peer" : low.address === pool.address ? "buy-on-current" : "neutral";
  const confidence = clamp(0.45 + Math.min(0.4, spreadPct / 12) + Math.min(0.15, peers.length * 0.03), 0.2, 0.98);

  return {
    eligible: spreadPct >= 1.8 && Boolean(bestDex && peerDex),
    spreadPct: round2(spreadPct),
    bestDex,
    peerDex,
    peerPoolAddress: low.address === pool.address ? high.address : low.address,
    direction,
    confidence: round2(confidence),
  };
}

function buildPumpfunGraduateEvidence(
  pool: PoolSnapshot,
  poolHistory: Array<{ capturedAt: string; pool: PoolSnapshot }>,
  feeVelocity: FeeVelocityEvidence,
): PumpfunGraduateEvidence {
  const progressPct = clamp(pool.bondingCurveProgressPct ?? estimateBondingCurveProgress(pool), 0, 100);
  const recent = poolHistory.slice(-5).map((entry) => entry.pool);
  const volumeTrend = deltaTrend(recent.map((item) => item.volume24hUsd));
  const feeTrend = deltaTrend(recent.map((item) => item.fee24hUsd));
  const velocityPct = clamp((volumeTrend + feeTrend) / 2, -100, 100);
  const timeToGraduateMinutes = progressPct >= 100
    ? 0
    : Math.max(1, Math.round(((100 - progressPct) / Math.max(1, Math.abs(velocityPct))) * 4 + (feeVelocity.acceleration > 2 ? 1 : 3)));
  const bullish = progressPct >= 85 && velocityPct >= 12 && (pool.socialVelocityScore ?? 0) >= 60;
  const bearish = progressPct >= 85 && velocityPct <= -8 && (pool.socialVelocityScore ?? 0) < 55;
  const confidence = clamp(
    0.35 + progressPct / 120 + Math.min(0.22, Math.abs(velocityPct) / 80) + (feeVelocity.quality > 0.6 ? 0.1 : 0),
    0.2,
    0.98,
  );

  return {
    eligible: progressPct >= 85,
    progressPct: round2(progressPct),
    velocityPct: round2(velocityPct),
    pattern: bullish ? "bullish" : bearish ? "bearish" : "mixed",
    timeToGraduateMinutes,
    confidence: round2(confidence),
    recommendedAction: bearish ? "REMOVE_LIQUIDITY" : bullish ? "ADD_LIQUIDITY" : "WAIT",
  };
}

function buildLiquidityTrapEvidence(
  pool: PoolSnapshot,
  poolHistory: Array<{ capturedAt: string; pool: PoolSnapshot }>,
  feeVelocity: FeeVelocityEvidence,
  smartMoneyShadow: SmartMoneyShadowEvidence,
): LiquidityTrapEvidence {
  const tokenProfile = classifyTokenProfile(pool);
  const recent = poolHistory.slice(-4).map((entry) => entry.pool.currentPrice).filter((price) => Number.isFinite(price) && price > 0);
  const priceTrend = recent.length >= 2 ? (recent.at(-1)! - recent[0]!) / recent[0]! : 0;
  const trend = priceTrend <= -0.05 ? "dumping" : priceTrend >= 0.05 ? "pumping" : "choppy";
  const bias = trend === "dumping" ? "below" : "above";
  const baseCenter = pool.activeBinId;
  const drift = Math.max(2, Math.round(Math.abs(priceTrend) * 18 + feeVelocity.acceleration * 1.5));
  const lowerBinId = Math.max(0, bias === "below" ? baseCenter - drift - 2 : baseCenter - 1);
  const upperBinId = Math.max(lowerBinId + 2, bias === "below" ? baseCenter + 1 : baseCenter + drift + 2);
  const centerBinId = Math.round((lowerBinId + upperBinId) / 2);
  const confidence = clamp(
    0.4 +
      (tokenProfile.category === "memecoin" ? 0.2 : 0) +
      feeVelocity.quality * 0.2 +
      smartMoneyShadow.clusterScore / 220 +
      Math.abs(priceTrend) * 2,
    0.2,
    0.98,
  );

  return {
    eligible: tokenProfile.category === "memecoin" && confidence >= 0.55,
    trend,
    centerBinId,
    lowerBinId,
    upperBinId,
    trapBias: bias,
    confidence: round2(confidence),
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
  const priceHistory = window.map((item) => item.currentPrice).filter((value) => Number.isFinite(value) && value > 0);
  const priceChangePct = priceHistory.length >= 2 ? ((priceHistory.at(-1)! - priceHistory[0]!) / priceHistory[0]!) * 100 : 0;
  const priceAdjustedDrawdownPct = clamp(Math.max(0, tvlDrawdownPct - Math.abs(priceChangePct) * 0.65), 0, 100);
  const eligible = Boolean(previous && priceAdjustedDrawdownPct >= 20 && volumeRetentionPct >= 90 && feeRateExpansionPct >= 15);
  const exitEligible = Boolean(previous && priceAdjustedDrawdownPct >= 30 && (volumeRetentionPct < 80 || feeRateExpansionPct < -10));

  return {
    eligible,
    tvlDrawdownPct: round2(tvlDrawdownPct),
    volumeRetentionPct: round2(volumeRetentionPct),
    feeRateExpansionPct: round2(feeRateExpansionPct),
    priceAdjustedDrawdownPct: round2(priceAdjustedDrawdownPct),
    exitEligible,
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

function estimateFdvUsd(pool: PoolSnapshot) {
  const baseline = pool.tvlUsd > 0 ? pool.tvlUsd * 8 : 100_000;
  const activityPremium = pool.volume24hUsd > 0 ? Math.min(pool.volume24hUsd * 2, baseline * 0.8) : 0;
  return round2(Math.max(10_000, baseline + activityPremium));
}

function estimateBondingCurveProgress(pool: PoolSnapshot) {
  if (typeof pool.bondingCurveProgressPct === "number") return pool.bondingCurveProgressPct;
  if (pool.migrateTarget === "RAYDIUM") return 100;
  if (pool.signalSeed === "ENTER" && pool.tvlUsd < 150_000) return 72;
  if (pool.signalSeed === "WATCH" && pool.tvlUsd < 500_000) return 48;
  return 0;
}

function classifyTokenProfile(pool: PoolSnapshot) {
  const ageHours = estimatePoolAgeHours(pool.createdAt);
  const holderCount = Array.isArray(pool.topHolderWallets) ? pool.topHolderWallets.length : 0;
  const concentration = Math.max(pool.topHolderSharePct ?? 0, pool.topTenHolderSharePct ?? 0);
  const fdvUsd = pool.fdvUsd ?? estimateFdvUsd(pool);
  const liquidityToFdv = fdvUsd > 0 ? pool.tvlUsd / fdvUsd : 0;
  const authorityRisk =
    (pool.mintAuthorityRevoked === false ? 1 : 0) +
    (pool.freezeAuthorityRevoked === false ? 1 : 0) +
    (pool.liquidityLocked === false ? 1 : 0);

  let score = 0;
  if (ageHours < 168) score += 2;
  if (holderCount > 0 && holderCount < 1000) score += 2;
  if (concentration >= 30) score += 2;
  if (liquidityToFdv < 0.1) score += 1;
  if (authorityRisk > 0) score += 1;

  if (score >= 5) {
    return {
      category: "memecoin" as const,
      confidence: clamp(score / 8, 0, 1),
      downsideMultiplier: 1.65,
      upsideMultiplier: 0.75,
      tailMultiplier: 1.45,
    };
  }

  if (ageHours >= 8_760 && holderCount >= 10_000 && concentration < 15) {
    return {
      category: "bluechip" as const,
      confidence: 0.82,
      downsideMultiplier: 1,
      upsideMultiplier: 1,
      tailMultiplier: 1.1,
    };
  }

  if (pool.tokenY === "USDC" || pool.tokenY === "USDT" || pool.tokenY === "USD") {
    return {
      category: "stable" as const,
      confidence: 0.7,
      downsideMultiplier: 0.9,
      upsideMultiplier: 0.9,
      tailMultiplier: 1.05,
    };
  }

  return {
    category: "unknown" as const,
    confidence: 0.38,
    downsideMultiplier: 1.2,
    upsideMultiplier: 1.05,
    tailMultiplier: 1.25,
  };
}

function dedupeTrendPoints(points: Array<{ time: number; price: number; binId: number }>) {
  const ordered = points.slice().sort((a, b) => a.time - b.time);
  const deduped: Array<{ time: number; price: number; binId: number }> = [];

  for (const point of ordered) {
    const prev = deduped[deduped.length - 1];
    if (!prev) {
      deduped.push(point);
      continue;
    }

    const samePrice = Math.abs(prev.price - point.price) <= Math.max(0.000001, prev.price * 0.0005);
    const sameBin = prev.binId === point.binId;
    const sameTime = prev.time === point.time;
    if (sameTime || (samePrice && sameBin)) continue;
    deduped.push(point);
  }

  return deduped;
}

function computeDirectionSupport(values: number[], trendDirection: number) {
  if (values.length < 2) return 0.5;
  let support = 0;
  let counted = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index]! - values[index - 1]!;
    if (delta === 0) continue;
    counted += 1;
    if (trendDirection === 0) {
      support += 0.5;
    } else if (Math.sign(delta) === trendDirection) {
      support += 1;
    }
  }
  return counted > 0 ? support / counted : 0.5;
}

function countDirectionFlips(values: number[]) {
  if (values.length < 3) return 0;
  let flips = 0;
  let lastDirection = 0;
  for (let index = 1; index < values.length; index += 1) {
    const delta = values[index]! - values[index - 1]!;
    if (delta === 0) continue;
    const direction = Math.sign(delta);
    if (lastDirection !== 0 && direction !== lastDirection) flips += 1;
    lastDirection = direction;
  }
  return flips;
}

function averageAbsDelta(values: number[]) {
  if (values.length < 2) return 0;
  let sum = 0;
  let count = 0;
  for (let index = 1; index < values.length; index += 1) {
    sum += Math.abs(values[index]! - values[index - 1]!);
    count += 1;
  }
  return count > 0 ? sum / count : 0;
}

function averageFlipPenalty(values: number[]) {
  const flips = countDirectionFlips(values);
  return values.length > 2 ? flips / (values.length - 2) : 0;
}

function safeTrend(current: number, previous: number) {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return 0;
  return clamp((current - previous) / Math.abs(previous), -2, 2);
}

function samplePointAtOrBefore(points: Array<{ time: number; pool: PoolSnapshot }>, targetTime: number) {
  let candidate: PoolSnapshot | undefined;
  for (const point of points) {
    if (point.time <= targetTime) {
      candidate = point.pool;
      continue;
    }
    break;
  }
  return candidate;
}

function poolPairKey(pool: PoolSnapshot) {
  const tokenA = normalizeTokenLabel(pool.tokenX);
  const tokenB = normalizeTokenLabel(pool.tokenY);
  return [tokenA, tokenB].sort().join("/");
}

function normalizeTokenLabel(value: string) {
  return value.trim().replace(/\s+/g, "").toUpperCase();
}

function uniqueWallets(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))];
}

function intersectionCount(left: string[], right: string[]) {
  const rightSet = new Set(right.map((value) => value.toLowerCase()));
  let count = 0;
  for (const value of left) {
    if (rightSet.has(value.toLowerCase())) count += 1;
  }
  return count;
}

function deltaTrend(values: number[]) {
  if (values.length < 2) return 0;
  const first = values[0]!;
  const last = values[values.length - 1]!;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return 0;
  return clamp(((last - first) / Math.abs(first)) * 100, -100, 100);
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
