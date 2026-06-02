import { createHash } from "node:crypto";
import type { MarketSnapshot, PoolSnapshot, Signal, TradeAction } from "./domain.js";
import { calculateImpermanentLossPct } from "./analytics.js";
import { analyzePoolIntelligence, type PoolIntelligenceContext } from "./intelligence.js";
import { recommendDynamicSlippageBps } from "./slippage.js";
import type { SignalWeights } from "./learning/signal-weight-tuner.js";

export type SignalContext = {
  previous?: MarketSnapshot;
  now: MarketSnapshot;
  history?: MarketSnapshot[];
  learningWeights?: Partial<SignalWeights>;
};

export type SignalEngineOptions = {
  minDegenScore?: number;
  minSocialVelocityScore?: number;
  maxPreviousRugsByDev?: number;
  maxWhalePressureScore?: number;
  splitPositionCount?: number;
  maxTopHolderSharePct?: number;
  maxTopTenHolderSharePct?: number;
  maxRugRiskScore?: number;
  learningWeights?: Partial<SignalWeights>;
};

export class SignalEngine {
  constructor(private readonly options: SignalEngineOptions = {}) {}

  generate(context: SignalContext): Signal[] {
    const signals: Signal[] = [];
    const learningWeights = context.learningWeights ?? this.options.learningWeights;

    for (const pool of context.now.pools) {
      const previous = context.previous?.pools.find((item) => item.address === pool.address);
      const deltas = computeDeltas(pool, previous);
      const profile = applyLearningWeights(deriveProfile(pool, previous, this.options), learningWeights);
      const poolSignals = buildSignalsForPool(
        pool,
        context.now.capturedAt,
        deltas,
        profile,
        previous,
        context.previous?.capturedAt,
        this.options,
        context.now.pools,
        context.history ?? [],
        context.now.capturedAt,
      );

      for (const signal of poolSignals) {
        signals.push(signal);
      }
    }

    signals.sort((a, b) => b.severity - a.severity || b.confidence - a.confidence);
    return signals;
  }
}

type DerivedProfile = {
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

function buildSignalsForPool(
  pool: PoolSnapshot,
  createdAt: string,
  deltas: ReturnType<typeof computeDeltas>,
  profile: DerivedProfile,
  previous: PoolSnapshot | undefined,
  previousCapturedAt: string | undefined,
  options: SignalEngineOptions,
  universe: PoolSnapshot[],
  history: MarketSnapshot[],
  capturedAt: string,
) {
  const signals: Signal[] = [];
  const minDegenScore = options.minDegenScore ?? 30;
  const minSocialVelocityScore = options.minSocialVelocityScore ?? 55;
  const maxPreviousRugsByDev = options.maxPreviousRugsByDev ?? 3;
  const maxWhalePressureScore = options.maxWhalePressureScore ?? 70;
  const splitCount = clampInt(options.splitPositionCount ?? 8, 1, 20);
  const intelligence = analyzePoolIntelligence({
    pool,
    previous,
    universe,
    history,
    capturedAt,
    context: profile as PoolIntelligenceContext,
    previousCapturedAt,
  });

  const rugTriggered =
    pool.mintAuthorityRevoked === false ||
    pool.freezeAuthorityRevoked === false ||
    pool.liquidityLocked === false ||
    (typeof pool.topTenHolderSharePct === "number" && pool.topTenHolderSharePct >= (options.maxTopTenHolderSharePct ?? 95)) ||
    (typeof pool.topHolderSharePct === "number" && pool.topHolderSharePct >= (options.maxTopHolderSharePct ?? 80)) ||
    profile.rugRiskScore >= (options.maxRugRiskScore ?? 70) ||
    profile.previousRugsByDev > maxPreviousRugsByDev ||
    profile.degenScore < minDegenScore;

  if (rugTriggered) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "RUG_SHIELD",
        action: "REMOVE_LIQUIDITY",
        confidence: 0.98,
        severity: 100,
        capitalScale: 0.3,
        slippageBps: recommendDynamicSlippageBps(pool, "REMOVE_LIQUIDITY", 35, pool.tvlUsd * 0.3, 150),
        priorityFeeMicroLamports: 3_000,
        reasons: buildRugReasons(pool, profile),
        variant: "primary",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 250,
          priorityProtection: "MAX",
          hedgeTo: "USDC",
        },
      }),
    );

    if (profile.rugRiskScore >= 80 || pool.liquidityLocked === false || pool.mintAuthorityRevoked === false) {
      signals.push(
        createSignal({
          createdAt,
          pool,
          profile,
          type: "INSURANCE_HEDGE",
          action: "HEDGE",
          confidence: 0.94,
          severity: 96,
          capitalScale: 0.22,
          slippageBps: recommendDynamicSlippageBps(pool, "SWAP", 45, pool.tvlUsd * 0.22, 180),
          priorityFeeMicroLamports: 3_500,
          reasons: [
            "Rug survivor insurance triggered",
            `Protective hedge to ${pool.tokenY || "USDC"}`,
            `Rug risk ${profile.rugRiskScore.toFixed(0)}`,
          ],
          variant: "secondary",
          executionHints: {
            splitCount,
            minDelayMs: 0,
            maxDelayMs: 150,
            priorityProtection: "MAX",
            hedgeTo: pool.tokenY || "USDC",
          },
        }),
      );
    }
    return signals;
  }

  if (profile.eventWindowActive && (profile.eventBlocksRemaining ?? 999) <= 30) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "FLASH_LP",
        action: "ADD_LIQUIDITY",
        confidence: 0.91,
        severity: 92,
        capitalScale: pool.signalSeed === "ENTER" ? 0.18 : 0.12,
        slippageBps: recommendDynamicSlippageBps(pool, "ADD_LIQUIDITY", 30, pool.tvlUsd * 0.15, 120),
        priorityFeeMicroLamports: 2_800,
        reasons: [
          `Event window active${profile.eventName ? `: ${profile.eventName}` : ""}`,
          `Only ${profile.eventBlocksRemaining ?? 0} blocks remaining`,
          "Flash LP opportunity",
        ],
        variant: "event-window",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 500,
          priorityProtection: "MAX",
        },
      }),
    );
  }

  if ((profile.bondingCurveProgressPct ?? 0) >= 95) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "BONDING_CURVE_ARB",
        action: profile.bondingCurveProgressPct >= 100 ? "REBALANCE" : "ADD_LIQUIDITY",
        confidence: 0.9,
        severity: profile.bondingCurveProgressPct >= 100 ? 95 : 88,
        capitalScale: profile.bondingCurveProgressPct >= 100 ? 0.2 : 0.15,
        slippageBps: recommendDynamicSlippageBps(pool, "ADD_LIQUIDITY", 40, pool.tvlUsd * 0.15, 150),
        priorityFeeMicroLamports: 2_700,
        reasons: [
          `Bonding curve ${profile.bondingCurveProgressPct.toFixed(0)}% complete`,
          profile.migrateTarget ? `Migrate target ${profile.migrateTarget}` : "Auto-migrate candidate",
          "Founding LP setup",
        ],
        variant: "bonding-curve",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 1_000,
          priorityProtection: "MAX",
          hedgeTo: profile.migrateTarget === "RAYDIUM" ? "SOL" : undefined,
        },
      }),
    );
  }

  const socialUp = profile.socialVelocityScore >= minSocialVelocityScore && profile.socialVelocityDelta >= 8;
  const socialDown = profile.socialVelocityScore < Math.max(20, minSocialVelocityScore - 20) || profile.socialVelocityDelta <= -12;
  if (socialUp || socialDown) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "SOCIAL_VELOCITY",
        action: socialDown ? "REMOVE_LIQUIDITY" : "ADD_LIQUIDITY",
        confidence: socialDown ? 0.82 : 0.9,
        severity: socialDown ? 88 : 84,
        capitalScale: socialDown ? 0.12 : 0.18,
        slippageBps: recommendDynamicSlippageBps(pool, socialDown ? "REMOVE_LIQUIDITY" : "ADD_LIQUIDITY", 45, pool.tvlUsd * 0.15, 140),
        priorityFeeMicroLamports: socialDown ? 2_100 : 2_300,
        reasons: socialDown
          ? [
              "Social velocity deteriorating",
              `Delta ${profile.socialVelocityDelta.toFixed(1)}`,
              `Score ${profile.socialVelocityScore.toFixed(1)}`,
            ]
          : [
              "Narrative velocity accelerating",
              `Delta ${profile.socialVelocityDelta.toFixed(1)}`,
              `Score ${profile.socialVelocityScore.toFixed(1)}`,
            ],
        variant: socialDown ? "social-down" : "social-up",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: socialDown ? 250 : 1_500,
          priorityProtection: socialDown ? "HIGH" : "MAX",
          hedgeTo: socialDown ? "USDC" : undefined,
        },
      }),
    );
  }

  if (profile.whalePressureScore >= maxWhalePressureScore || Math.abs(profile.whaleFlowBps) >= 900) {
    const whaleExit = profile.whaleFlowBps < 0 || profile.whalePressureScore >= maxWhalePressureScore + 12;
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "WHALE_ADJUST",
        action: whaleExit ? "REMOVE_LIQUIDITY" : "REBALANCE",
        confidence: 0.88,
        severity: whaleExit ? 94 : 87,
        capitalScale: whaleExit ? 0.1 : 0.16,
        slippageBps: recommendDynamicSlippageBps(pool, whaleExit ? "REMOVE_LIQUIDITY" : "REBALANCE", 40, pool.tvlUsd * 0.15, 160),
        priorityFeeMicroLamports: whaleExit ? 2_600 : 2_200,
        reasons: [
          `Whale pressure ${profile.whalePressureScore.toFixed(1)}`,
          `Whale flow ${profile.whaleFlowBps.toFixed(0)} bps`,
          whaleExit ? "Reducing exit liquidity exposure" : "Adjusting range toward whale flow",
        ],
        variant: whaleExit ? "whale-exit" : "whale-adjust",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 1_000,
          priorityProtection: "MAX",
          hedgeTo: whaleExit ? "USDC" : undefined,
        },
      }),
    );
  }

  const smartMoneyMomentum = pool.smartMoneyScore >= 75 && deltas.volumePct > 10 && profile.degenScore >= minDegenScore + 15;
  if (smartMoneyMomentum) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "SNIPER_SHADOW",
        action: "ADD_LIQUIDITY",
        confidence: 0.87,
        severity: 86,
        capitalScale: 0.17,
        slippageBps: recommendDynamicSlippageBps(pool, "ADD_LIQUIDITY", 35, pool.tvlUsd * 0.15, 150),
        priorityFeeMicroLamports: 2_400,
        reasons: [
          "Smart money clustered into the pool",
          `Smart money score ${pool.smartMoneyScore.toFixed(0)}`,
          "Counter-sniper LP setup",
        ],
        variant: "smart-money",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 2_000,
          priorityProtection: "MAX",
        },
      }),
    );
  }

  if (pool.feeRatePct >= 0.4 && pool.jupScore >= 65 && profile.degenScore >= minDegenScore + 10) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "COPY_PASTE_LP",
        action: "ADD_LIQUIDITY",
        confidence: 0.86,
        severity: 82,
        capitalScale: 0.2,
        slippageBps: recommendDynamicSlippageBps(pool, "ADD_LIQUIDITY", 50, pool.tvlUsd * 0.18, 150),
        priorityFeeMicroLamports: 1_900,
        reasons: [
          "Profitability pattern matches top LP pools",
          `Fee rate ${pool.feeRatePct.toFixed(2)}%`,
          `Degen score ${profile.degenScore.toFixed(1)}`,
        ],
        variant: "copy-paste",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 1_500,
          priorityProtection: "HIGH",
        },
      }),
    );
  }

  if (intelligence.tickRange && intelligence.tickRange.confidence >= 0.65) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "TICK_RANGE_PROPHET",
        action: "REBALANCE",
        confidence: intelligence.tickRange.confidence,
        severity: Math.round(80 + Math.min(12, Math.abs(intelligence.tickRange.predictedMoveBps) / 50)),
        capitalScale: 0.16,
        slippageBps: recommendDynamicSlippageBps(pool, "REBALANCE", 45, pool.tvlUsd * 0.15, 140),
        priorityFeeMicroLamports: 2_100,
        reasons: [
          `Regression R² ${intelligence.tickRange.regressionR2.toFixed(2)} from ${intelligence.tickRange.sampleCount} samples`,
          `Forecast move ${intelligence.tickRange.predictedMoveBps.toFixed(0)} bps over ${intelligence.tickRange.horizonMinutes}m`,
          `Tick center ${intelligence.tickRange.centerBinId}`,
          `Predicted band ${intelligence.tickRange.lowerBinId}-${intelligence.tickRange.upperBinId}`,
          `Token profile ${intelligence.tickRange.tokenProfile.category} (${(intelligence.tickRange.tokenProfile.confidence * 100).toFixed(0)}%)`,
          `Tail multiplier ${intelligence.tickRange.tokenProfile.tailMultiplier.toFixed(2)}x`,
        ],
        variant: "tick-range-prophet",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 1_000,
          priorityProtection: "MAX",
          tickRange: intelligence.tickRange,
        },
      }),
    );
  }

  if (intelligence.feeVelocity.eligible) {
    const feeMomentumAction: TradeAction =
      intelligence.feeVelocity.tvlHealth < 0.92 || intelligence.feeVelocity.quality < 0.62 ? "REBALANCE" : "ADD_LIQUIDITY";
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "FEE_MOMENTUM",
        action: feeMomentumAction,
        confidence: clamp01(0.66 + Math.min(0.28, intelligence.feeVelocity.confidence * 0.35)),
        severity: Math.min(93, Math.round(70 + Math.min(18, intelligence.feeVelocity.acceleration * 3) + Math.min(8, intelligence.feeVelocity.feeEfficiency * 1000))),
        capitalScale: feeMomentumAction === "REBALANCE" ? 0.14 : 0.18,
        slippageBps: recommendDynamicSlippageBps(pool, feeMomentumAction, 40, pool.tvlUsd * 0.14, 130),
        priorityFeeMicroLamports: 1_950,
        reasons: [
          `Acceleration ${intelligence.feeVelocity.acceleration.toFixed(2)}x`,
          `Directional quality ${(intelligence.feeVelocity.quality * 100).toFixed(0)}%`,
          `Fee efficiency ${(intelligence.feeVelocity.feeEfficiency * 100).toFixed(3)}%`,
          `TVL health ${(intelligence.feeVelocity.tvlHealth * 100).toFixed(0)}%`,
          `5m volume ${intelligence.feeVelocity.volume5mUsd.toFixed(0)} USD`,
        ],
        variant: "fee-velocity",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: intelligence.feeVelocity.tvlHealth < 0.95 ? 1_000 : 500,
          priorityProtection: intelligence.feeVelocity.tvlHealth < 0.95 ? "MAX" : "HIGH",
        },
      }),
    );
  }

  if (intelligence.liquidityVacuum.eligible) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "LIQUIDITY_VACUUM",
        action: "ADD_LIQUIDITY",
        confidence: clamp01(0.72 + intelligence.liquidityVacuum.tvlDrawdownPct / 200),
        severity: Math.min(98, Math.round(76 + intelligence.liquidityVacuum.tvlDrawdownPct * 0.25)),
        capitalScale: 0.12,
        slippageBps: recommendDynamicSlippageBps(pool, "ADD_LIQUIDITY", 40, pool.tvlUsd * 0.1, 130),
        priorityFeeMicroLamports: 2_600,
        reasons: [
          `TVL drawdown ${intelligence.liquidityVacuum.tvlDrawdownPct.toFixed(1)}%`,
          `Volume retention ${intelligence.liquidityVacuum.volumeRetentionPct.toFixed(1)}%`,
          `Fee-rate expansion ${intelligence.liquidityVacuum.feeRateExpansionPct.toFixed(1)}%`,
        ],
        variant: "liquidity-vacuum",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 250,
          priorityProtection: "MAX",
        },
      }),
    );
  }

  if (intelligence.liquidityVacuum.exitEligible) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "RISK_EXIT",
        action: "REMOVE_LIQUIDITY",
        confidence: clamp01(0.74 + Math.min(0.18, intelligence.liquidityVacuum.priceAdjustedDrawdownPct / 200)),
        severity: Math.min(98, Math.round(84 + intelligence.liquidityVacuum.priceAdjustedDrawdownPct * 0.2)),
        capitalScale: 0.12,
        slippageBps: recommendDynamicSlippageBps(pool, "REMOVE_LIQUIDITY", 35, pool.tvlUsd * 0.1, 140),
        priorityFeeMicroLamports: 2_700,
        reasons: [
          `Price-adjusted drawdown ${intelligence.liquidityVacuum.priceAdjustedDrawdownPct.toFixed(1)}%`,
          `Volume retention ${intelligence.liquidityVacuum.volumeRetentionPct.toFixed(1)}%`,
          `Fee-rate expansion ${intelligence.liquidityVacuum.feeRateExpansionPct.toFixed(1)}%`,
          "Liquidity drain risk detected",
        ],
        variant: "liquidity-drain-exit",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 250,
          priorityProtection: "MAX",
          hedgeTo: "USDC",
        },
      }),
    );
  }

  if (intelligence.walletFingerprint.eligible) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "WALLET_FINGERPRINT",
        action: "REMOVE_LIQUIDITY",
        confidence: clamp01(0.68 + Math.min(0.24, intelligence.walletFingerprint.priorRugsByDev / 20)),
        severity: Math.min(99, Math.round(72 + intelligence.walletFingerprint.priorRugsByDev * 4)),
        capitalScale: 0.15,
        slippageBps: recommendDynamicSlippageBps(pool, "REMOVE_LIQUIDITY", 35, pool.tvlUsd * 0.1, 130),
        priorityFeeMicroLamports: 2_900,
        reasons: [
          `Creator ${intelligence.walletFingerprint.creatorAddress}`,
          `Fingerprint ${intelligence.walletFingerprint.fingerprintId}`,
          `Trigger ${intelligence.walletFingerprint.triggerReason}`,
        ],
        variant: "wallet-blacklist",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 200,
          priorityProtection: "MAX",
          fingerprintRisk: Math.min(100, intelligence.walletFingerprint.priorRugsByDev * 20),
          hedgeTo: "USDC",
        },
      }),
    );
  }

  if (intelligence.feeCompounding.eligible) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "FEE_COMPOUNDING_FLYWHEEL",
        action: "REBALANCE",
        confidence: clamp01(0.68 + Math.min(0.25, intelligence.feeCompounding.ratio / 120)),
        severity: Math.min(94, Math.round(72 + Math.min(18, intelligence.feeCompounding.ratio))),
        capitalScale: 0.18,
        slippageBps: recommendDynamicSlippageBps(pool, "REBALANCE", 40, pool.tvlUsd * 0.12, 130),
        priorityFeeMicroLamports: 1_850,
        reasons: [
          `Fee / execution cost ratio ${intelligence.feeCompounding.ratio.toFixed(1)}x`,
          `Execution cost ${intelligence.feeCompounding.executionCostUsd.toFixed(2)} USD`,
          `Threshold ${intelligence.feeCompounding.threshold.toFixed(1)}x`,
        ],
        variant: "fee-compound",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 1_500,
          priorityProtection: "HIGH",
          compoundingRatio: intelligence.feeCompounding.ratio,
        },
      }),
    );
  }

  if (intelligence.narrativeCluster.eligible) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "NARRATIVE_GRAPH",
        action: "REBALANCE",
        confidence: clamp01(0.55 + intelligence.narrativeCluster.score / 180),
        severity: Math.min(93, Math.round(68 + intelligence.narrativeCluster.score * 0.33)),
        capitalScale: 0.16,
        slippageBps: recommendDynamicSlippageBps(pool, "ADD_LIQUIDITY", 45, pool.tvlUsd * 0.12, 140),
        priorityFeeMicroLamports: 2_050,
        reasons: [
          `Shared-holder overlap score ${intelligence.narrativeCluster.score.toFixed(1)}`,
          `Related pools ${intelligence.narrativeCluster.relatedPools.length}`,
          `Overlap max ${Math.max(...Object.values(intelligence.narrativeCluster.overlapRatios), 0).toFixed(2)}`,
        ],
        variant: "narrative-graph",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 1_200,
          priorityProtection: "MAX",
          relatedPools: intelligence.narrativeCluster.relatedPools,
        },
      }),
    );
  }

  if (intelligence.deadPool.eligible) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "DEAD_POOL_RESURRECTOR",
        action: "ADD_LIQUIDITY",
        confidence: clamp01(0.58 + Math.min(0.3, intelligence.deadPool.volumeToTvlRatio / 2)),
        severity: Math.min(92, Math.round(66 + intelligence.deadPool.volumeToTvlRatio * 120)),
        capitalScale: 0.08,
        slippageBps: recommendDynamicSlippageBps(pool, "ADD_LIQUIDITY", 35, pool.tvlUsd * 0.08, 100),
        priorityFeeMicroLamports: 1_650,
        reasons: [
          `Age ${intelligence.deadPool.ageHours.toFixed(1)}h`,
          `TVL ${intelligence.deadPool.tvlUsd.toFixed(0)} USD`,
          `Volume / TVL ${intelligence.deadPool.volumeToTvlRatio.toFixed(2)}`,
        ],
        variant: "dead-pool",
        executionHints: {
          splitCount: 1,
          minDelayMs: 0,
          maxDelayMs: 3_000,
          priorityProtection: "HIGH",
        },
      }),
    );
  }

  if (intelligence.executionAuction.candidates.length > 0) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "EXECUTION_AUCTION",
        action: pool.signalSeed === "AVOID" ? "SWAP" : "ADD_LIQUIDITY",
        confidence: 0.8,
        severity: Math.min(90, Math.round(70 + intelligence.executionAuction.candidates.length * 5)),
        capitalScale: 0.14,
        slippageBps: recommendDynamicSlippageBps(pool, pool.signalSeed === "AVOID" ? "SWAP" : "ADD_LIQUIDITY", 45, pool.tvlUsd * 0.12, 140),
        priorityFeeMicroLamports: 2_300,
        reasons: [
          ...intelligence.executionAuction.rationale,
          `Execution auction over ${intelligence.executionAuction.candidates.join(", ")}`,
          `Preferred route ${intelligence.executionAuction.preferredRoute}`,
          `Simulation budget ${intelligence.executionAuction.simulationBudgetMs}ms`,
        ],
        variant: "execution-auction",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: intelligence.executionAuction.simulationBudgetMs,
          priorityProtection: intelligence.executionAuction.preferredRoute === "JITO" ? "MAX" : "HIGH",
          routeAuction: intelligence.executionAuction,
        },
      }),
    );
  }

  if (intelligence.phantomLiquidity.eligible) {
    signals.push(
      createSignal({
        createdAt,
        pool,
        profile,
        type: "PHANTOM_LIQUIDITY",
        action: "REMOVE_LIQUIDITY",
        confidence: clamp01(0.62 + Math.min(0.28, intelligence.phantomLiquidity.honeypotSimulationBps / 600)),
        severity: Math.min(96, Math.round(70 + intelligence.phantomLiquidity.honeypotSimulationBps * 0.25)),
        capitalScale: 0.1,
        slippageBps: recommendDynamicSlippageBps(pool, "REMOVE_LIQUIDITY", 35, pool.tvlUsd * 0.1, 150),
        priorityFeeMicroLamports: 2_750,
        reasons: [
          `MEV attacks ${intelligence.phantomLiquidity.mevAttackCount}`,
          `Honeypot simulation ${intelligence.phantomLiquidity.honeypotSimulationBps.toFixed(0)} bps`,
          `Trap budget ${intelligence.phantomLiquidity.trapBudgetUsd.toFixed(2)} USD`,
        ],
        variant: "phantom-liquidity",
        executionHints: {
          splitCount,
          minDelayMs: 0,
          maxDelayMs: 200,
          priorityProtection: "MAX",
          phantomLiquidity: true,
        },
      }),
    );
  }

  if (signals.length > 0) {
    return signals;
  }

      const legacy = buildLegacySignal(pool, createdAt, deltas, profile, previous);
  if (legacy) signals.push(legacy);

  return signals;
}

function buildLegacySignal(
  pool: PoolSnapshot,
  createdAt: string,
  deltas: ReturnType<typeof computeDeltas>,
  profile: DerivedProfile,
  previous?: PoolSnapshot,
) {
  const reasons: string[] = [];
  let type: Signal["type"] = "FEE_MOMENTUM";
  let action: TradeAction = "WAIT";
  let confidence = clamp01(pool.signalScore / 100);
  let severity = Math.round(pool.signalScore * 0.75);
  let capitalScale = 0.25;
  let slippageBps = 50;
  let priorityFeeMicroLamports = 1_500;
  const impermanentLossPct = previous ? Math.abs(calculateImpermanentLossPct(previous.currentPrice || 1, pool.currentPrice || 1)) : 0;

  if (pool.ilRisk === "HIGH" && pool.signalScore < 70) {
    type = "RISK_EXIT";
    action = "REMOVE_LIQUIDITY";
    reasons.push("High IL risk with insufficient score");
    capitalScale = 0.15;
    confidence = Math.max(confidence, 0.7);
    severity = 90;
    slippageBps = recommendDynamicSlippageBps(pool, action, 35, pool.tvlUsd * capitalScale, 150);
    priorityFeeMicroLamports = 2_000;
  } else if (deltas.liquidityPct > 20 && deltas.volumePct > 20 && pool.ilRisk !== "HIGH") {
    type = "LIQUIDITY_SURGE";
    action = "ADD_LIQUIDITY";
    reasons.push(`Liquidity up ${formatPct(deltas.liquidityPct)}`);
    reasons.push(`Volume up ${formatPct(deltas.volumePct)}`);
    capitalScale = 0.2;
    confidence = Math.min(0.95, confidence + 0.18);
    severity = Math.min(100, severity + 12);
    slippageBps = recommendDynamicSlippageBps(pool, action, 60, pool.tvlUsd * capitalScale, 150);
    priorityFeeMicroLamports = 1_800;
  } else if (Math.abs(pool.currentPrice) > 0 && Math.abs(deltas.pricePct) > 12) {
    type = "PRICE_DISLOCATION";
    action = "SWAP";
    reasons.push(`Price moved ${formatPct(deltas.pricePct)}`);
    reasons.push("Potential hedge or re-entry opportunity");
    capitalScale = 0.18;
    confidence = Math.min(0.9, confidence + 0.12);
    severity = Math.min(100, severity + 18);
    slippageBps = recommendDynamicSlippageBps(pool, action, 70, pool.tvlUsd * capitalScale, 150);
    priorityFeeMicroLamports = 2_200;
  } else if (pool.feeRatePct > 0.4 && pool.jupScore >= 65) {
    type = "FEE_MOMENTUM";
    action = "ADD_LIQUIDITY";
    reasons.push("Healthy fee rate and score");
    reasons.push(`Fee rate ${pool.feeRatePct.toFixed(2)}%`);
    capitalScale = 0.22;
    confidence = Math.min(0.92, confidence + 0.1);
    severity = Math.min(100, severity + 8);
    slippageBps = recommendDynamicSlippageBps(pool, action, 55, pool.tvlUsd * capitalScale, 150);
    priorityFeeMicroLamports = 1_600;
  }

  if (slippageBps <= 0) {
    slippageBps = recommendDynamicSlippageBps(pool, action, 50, pool.tvlUsd * capitalScale, 150);
  }

  if (deltas.liquidityPct < -15 || deltas.volumePct < -20) {
    reasons.push("Liquidity or volume weakening vs previous cycle");
    severity = Math.max(severity, 70);
    confidence = Math.max(0.45, confidence - 0.08);
  }

  if (profile.degenScore < 30) {
    reasons.push(`Degen score ${profile.degenScore.toFixed(1)} below aggressive threshold`);
    severity = Math.min(100, severity + 4);
  }

  if (impermanentLossPct > 5) {
    reasons.push(`Estimated impermanent loss ${impermanentLossPct.toFixed(2)}%`);
    severity = Math.min(100, severity + 6);
  }

  if (action === "WAIT") return null;

  return createSignal({
    createdAt,
    pool,
    profile,
    type,
    action,
    confidence,
    severity,
    capitalScale,
    slippageBps,
    priorityFeeMicroLamports,
    reasons,
    variant: "legacy",
    executionHints: buildExecutionHints(type, action, pool, profile, splitCountFromProfile(profile)),
  });
}

function createSignal(params: {
  createdAt: string;
  pool: PoolSnapshot;
  profile: DerivedProfile;
  type: Signal["type"];
  action: TradeAction;
  confidence: number;
  severity: number;
  capitalScale: number;
  slippageBps: number;
  priorityFeeMicroLamports: number;
  reasons: string[];
  variant: string;
  executionHints?: Signal["executionHints"];
}): Signal {
  const suggestedCapitalUsd = round2(Math.max(25, params.pool.tvlUsd * params.capitalScale));
  const id = createSignalId({
    snapshotAt: params.createdAt,
    poolAddress: params.pool.address,
    poolName: params.pool.name,
    type: params.type,
    action: params.action,
    confidence: round2(params.confidence),
    severity: params.severity,
    capitalUsd: suggestedCapitalUsd,
    slippageBps: params.slippageBps,
    priorityFeeMicroLamports: params.priorityFeeMicroLamports,
    variant: params.variant,
  });

  return {
    id,
    type: params.type,
    action: params.action,
    poolAddress: params.pool.address,
    poolName: params.pool.name,
    risk: params.pool.ilRisk,
    confidence: round2(params.confidence),
    severity: params.severity,
    reason: params.reasons,
    suggestedCapitalUsd,
    slippageBps: params.slippageBps,
    priorityFeeMicroLamports: params.priorityFeeMicroLamports,
    impermanentLossPct: round2(Math.abs(calculateImpermanentLossPct(params.pool.currentPrice || 1, params.pool.currentPrice || 1)) * 100),
    degenScore: round2(params.profile.degenScore),
    socialVelocityScore: round2(params.profile.socialVelocityScore),
    whalePressureScore: round2(params.profile.whalePressureScore),
    eventName: params.profile.eventName,
    executionHints: params.executionHints ?? buildExecutionHints(params.type, params.action, params.pool, params.profile, splitCountFromProfile(params.profile)),
    createdAt: params.createdAt,
  };
}

function buildExecutionHints(
  type: Signal["type"],
  action: TradeAction,
  pool: PoolSnapshot,
  profile: DerivedProfile,
  splitCount: number,
): NonNullable<Signal["executionHints"]> {
  const isProtective = type === "RUG_SHIELD" || type === "INSURANCE_HEDGE" || type === "WHALE_ADJUST" || action === "HEDGE" || action === "REMOVE_LIQUIDITY";
  const isFlash = type === "FLASH_LP" || type === "BONDING_CURVE_ARB";
  const priorityProtection = isProtective || isFlash || pool.tvlUsd < 250_000 ? "MAX" : "HIGH";
  const delayCeil = type === "FLASH_LP" ? 500 : type === "SOCIAL_VELOCITY" ? 1_500 : isProtective ? 250 : 2_000;
  return {
    splitCount: clampInt(splitCount, 1, 20),
    minDelayMs: 0,
    maxDelayMs: delayCeil,
    priorityProtection,
    hedgeTo:
      action === "HEDGE" || type === "INSURANCE_HEDGE" || type === "RUG_SHIELD"
        ? "USDC"
        : type === "BONDING_CURVE_ARB" && profile.migrateTarget === "RAYDIUM"
          ? "SOL"
          : undefined,
  };
}

function buildRugReasons(pool: PoolSnapshot, profile: DerivedProfile) {
  const reasons: string[] = ["Rug Pull Shield triggered"];
  if (pool.mintAuthorityRevoked === false) reasons.push("Mint authority is still active");
  if (pool.freezeAuthorityRevoked === false) reasons.push("Freeze authority is still active");
  if (pool.liquidityLocked === false) reasons.push("Liquidity is not locked");
  if (typeof pool.topHolderSharePct === "number" && pool.topHolderSharePct >= 80) {
    reasons.push(`Top holder concentration ${pool.topHolderSharePct.toFixed(1)}%`);
  }
  if (typeof pool.topTenHolderSharePct === "number" && pool.topTenHolderSharePct >= 80) {
    reasons.push(`Top 10 holders concentration ${pool.topTenHolderSharePct.toFixed(1)}%`);
  }
  if (profile.previousRugsByDev > 0) reasons.push(`Dev wallet linked to ${profile.previousRugsByDev} prior rugs`);
  if (profile.rugRiskScore > 0) reasons.push(`Rug risk score ${profile.rugRiskScore.toFixed(0)}`);
  return reasons;
}

function deriveProfile(
  pool: PoolSnapshot,
  previous: PoolSnapshot | undefined,
  options: SignalEngineOptions,
): DerivedProfile {
  const holderGini = clamp(
    typeof pool.holderGini === "number"
      ? pool.holderGini
      : estimateHolderGini(pool.topHolderSharePct, pool.topTenHolderSharePct),
    0,
    1,
  );
  const previousRugsByDev = pool.previousRugsByDev ?? estimatePreviousRugsByDev(pool);
  const socialVelocityScore = pool.socialVelocityScore ?? estimateSocialVelocityScore(pool);
  const previousSocialVelocityScore = previous?.socialVelocityScore ?? socialVelocityScore;
  const socialVelocityDelta = pool.socialVelocityDelta ?? socialVelocityScore - previousSocialVelocityScore;
  const whaleFlowBps = pool.whaleFlowBps ?? estimateWhaleFlowBps(pool, holderGini);
  const whalePressureScore = pool.whalePressureScore ?? estimateWhalePressureScore(pool, whaleFlowBps, options.maxTopTenHolderSharePct ?? 95);
  const bondingCurveProgressPct = pool.bondingCurveProgressPct ?? estimateBondingCurveProgress(pool);
  const eventWindowActive = Boolean(
    pool.eventWindowActive ?? (bondingCurveProgressPct >= 95 || socialVelocityScore >= (options.minSocialVelocityScore ?? 55) + 10),
  );
  const eventName = pool.eventName ?? inferEventName(pool, eventWindowActive);
  const eventBlocksRemaining = pool.eventBlocksRemaining ?? estimateEventBlocksRemaining(pool, eventWindowActive);
  const migrateTarget = pool.migrateTarget ?? inferMigrateTarget(pool, bondingCurveProgressPct);
  const contractRiskScore = pool.contractRiskScore ?? estimateContractRiskScore(pool, previousRugsByDev);
  const rugRiskScore = pool.rugRiskScore ?? estimateRugRiskScore(pool, contractRiskScore, previousRugsByDev, holderGini);
  const degenScore = pool.degenScore ?? estimateDegenScore(pool, holderGini, previousRugsByDev, contractRiskScore, socialVelocityScore, whalePressureScore);

  return {
    degenScore,
    socialVelocityScore,
    socialVelocityDelta,
    whalePressureScore,
    whaleFlowBps,
    bondingCurveProgressPct,
    eventWindowActive,
    eventName,
    eventBlocksRemaining,
    migrateTarget,
    rugRiskScore,
    previousRugsByDev,
    holderGini,
  };
}

function applyLearningWeights(profile: DerivedProfile, weights?: Partial<SignalWeights>): DerivedProfile {
  if (!weights) return profile;

  const holderWeight = clamp(weights.holderGini ?? 1, 0.1, 3);
  const socialWeight = clamp(weights.socialVelocity ?? 1, 0.1, 3);
  const degenWeight = clamp(weights.degenScore ?? 1, 0.1, 3);
  const whaleWeight = clamp(weights.whalePressureScore ?? 1, 0.1, 3);
  const rugsWeight = clamp(weights.previousRugs ?? 1, 0.1, 3);

  return {
    ...profile,
    holderGini: clamp(profile.holderGini * holderWeight, 0, 1),
    socialVelocityScore: clamp(profile.socialVelocityScore * socialWeight, 0, 100),
    degenScore: clamp(profile.degenScore * degenWeight, 0, 100),
    whalePressureScore: clamp(profile.whalePressureScore * whaleWeight, 0, 100),
    previousRugsByDev: Math.max(0, Math.round(profile.previousRugsByDev * rugsWeight)),
  };
}

function estimateHolderGini(topHolderSharePct?: number, topTenHolderSharePct?: number) {
  const topOne = (topHolderSharePct ?? 20) / 100;
  const topTen = (topTenHolderSharePct ?? Math.max(topHolderSharePct ?? 20, 35)) / 100;
  return clamp(topTen * 0.75 + topOne * 0.25, 0, 1);
}

function estimatePreviousRugsByDev(pool: PoolSnapshot) {
  if (typeof pool.previousRugsByDev === "number") return pool.previousRugsByDev;
  if (typeof pool.rugRiskScore === "number" && pool.rugRiskScore >= 80) return 2;
  return 0;
}

function estimateContractRiskScore(pool: PoolSnapshot, previousRugsByDev: number) {
  let score = 0;
  if (pool.mintAuthorityRevoked === false) score += 35;
  if (pool.freezeAuthorityRevoked === false) score += 25;
  if (pool.liquidityLocked === false) score += 15;
  if ((pool.topTenHolderSharePct ?? 0) > 85) score += 15;
  if (previousRugsByDev > 0) score += Math.min(20, previousRugsByDev * 8);
  return clamp(score, 0, 100);
}

function estimateSocialVelocityScore(pool: PoolSnapshot) {
  const activity = pool.tvlUsd > 0 ? pool.volume24hUsd / pool.tvlUsd : 0;
  const momentum = pool.feeRatePct * 4 + (pool.smartMoneyScore ?? 0) * 0.25 + (pool.jupScore ?? 0) * 0.12;
  const narrative = pool.signalSeed === "ENTER" ? 15 : pool.signalSeed === "WATCH" ? 7 : -10;
  return clamp(15 + activity * 20 + momentum + narrative, 0, 100);
}

function estimateWhaleFlowBps(pool: PoolSnapshot, holderGini: number) {
  const concentration = pool.topTenHolderSharePct ?? pool.topHolderSharePct ?? 40;
  const depth = pool.tvlUsd > 0 ? pool.volume24hUsd / pool.tvlUsd : 0;
  return round2((concentration - 45) * 12 + (holderGini - 0.5) * 1_500 + depth * 180);
}

function estimateWhalePressureScore(pool: PoolSnapshot, whaleFlowBps: number, maxTopTenHolderSharePct: number) {
  const concentration = pool.topTenHolderSharePct ?? 40;
  return clamp(concentration * 0.45 + Math.abs(whaleFlowBps) / 30 + (pool.rugRiskScore ?? 45) * 0.2 + (concentration > maxTopTenHolderSharePct ? 8 : 0), 0, 100);
}

function estimateBondingCurveProgress(pool: PoolSnapshot) {
  if (typeof pool.bondingCurveProgressPct === "number") return pool.bondingCurveProgressPct;
  if (pool.migrateTarget === "RAYDIUM") return 100;
  if (pool.signalSeed === "ENTER" && pool.tvlUsd < 150_000) return 72;
  if (pool.signalSeed === "WATCH" && pool.tvlUsd < 500_000) return 48;
  return 0;
}

function inferMigrateTarget(pool: PoolSnapshot, bondingCurveProgressPct: number) {
  if (bondingCurveProgressPct >= 100) return "RAYDIUM";
  if (pool.signalSeed === "WATCH" && bondingCurveProgressPct > 60) return "METEORA";
  if (pool.signalScore > 80) return "ORCA";
  return "UNKNOWN";
}

function inferEventName(pool: PoolSnapshot, eventWindowActive: boolean) {
  if (!eventWindowActive) return undefined;
  if (pool.signalSeed === "ENTER") return "Narrative breakout";
  if (pool.signalSeed === "WATCH") return "Community surge";
  return "Event window";
}

function estimateEventBlocksRemaining(pool: PoolSnapshot, eventWindowActive: boolean) {
  if (!eventWindowActive) return undefined;
  if (pool.signalSeed === "ENTER") return 18;
  if (pool.signalSeed === "WATCH") return 36;
  return 12;
}

function estimateFdvUsd(pool: PoolSnapshot) {
  const baseline = pool.tvlUsd > 0 ? pool.tvlUsd * 8 : 100_000;
  const activityPremium = pool.volume24hUsd > 0 ? Math.min(pool.volume24hUsd * 2, baseline * 0.8) : 0;
  return round2(Math.max(10_000, baseline + activityPremium));
}

function estimateRugRiskScore(pool: PoolSnapshot, contractRiskScore: number, previousRugsByDev: number, holderGini: number) {
  const authorityPenalty = (pool.mintAuthorityRevoked === false ? 30 : 0) + (pool.freezeAuthorityRevoked === false ? 20 : 0);
  const liquidityPenalty = pool.liquidityLocked === false ? 15 : 0;
  const holderPenalty = holderGini > 0.65 ? Math.round((holderGini - 0.65) * 100) : 0;
  const devPenalty = previousRugsByDev * 12;
  return clamp(authorityPenalty + liquidityPenalty + holderPenalty + devPenalty + contractRiskScore * 0.55, 0, 100);
}

function estimateDegenScore(
  pool: PoolSnapshot,
  holderGini: number,
  previousRugsByDev: number,
  contractRiskScore: number,
  socialVelocityScore: number,
  whalePressureScore: number,
) {
  const fdvUsd = pool.fdvUsd ?? estimateFdvUsd(pool);
  const liquidityScore = fdvUsd > 0 ? clamp((pool.tvlUsd / fdvUsd) * 180, 0, 100) : 0;
  const holderScore = clamp((1 - holderGini) * 100, 0, 100);
  const ageDays = estimateDevWalletAgeDays(pool.createdAt);
  const ageScore = clamp(ageDays * 1.8, 0, 100);
  const contractScore = clamp(100 - contractRiskScore, 0, 100);
  const rugsPenalty = Math.min(45, previousRugsByDev * 12);
  const whalePenalty = Math.min(35, whalePressureScore * 0.35);
  const score = 8
    + liquidityScore * 0.25
    + holderScore * 0.18
    + ageScore * 0.14
    + socialVelocityScore * 0.18
    + contractScore * 0.16
    - rugsPenalty
    - whalePenalty;
  return clamp(score, 0, 100);
}

function estimateDevWalletAgeDays(createdAt?: string) {
  if (!createdAt) return 7;
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return 7;
  return Math.max(1, Math.round((Date.now() - timestamp) / 86_400_000));
}

function splitCountFromProfile(profile: DerivedProfile) {
  if (profile.eventWindowActive) return 12;
  if (profile.whalePressureScore > 75) return 10;
  if (profile.socialVelocityScore > 70) return 8;
  return 6;
}

function computeDeltas(pool: PoolSnapshot, previous?: PoolSnapshot) {
  if (!previous || previous.tvlUsd <= 0 || previous.volume24hUsd <= 0 || previous.currentPrice <= 0) {
    return { liquidityPct: 0, volumePct: 0, pricePct: 0 };
  }

  return {
    liquidityPct: ((pool.tvlUsd - previous.tvlUsd) / previous.tvlUsd) * 100,
    volumePct: ((pool.volume24hUsd - previous.volume24hUsd) / previous.volume24hUsd) * 100,
    pricePct: ((pool.currentPrice - previous.currentPrice) / previous.currentPrice) * 100,
  };
}

function createSignalId(input: Record<string, unknown>) {
  return `sig_${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}
