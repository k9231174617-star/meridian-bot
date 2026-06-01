import { randomUUID } from "node:crypto";
import type { MarketSnapshot, RiskDecision, RiskPolicy, Signal, TradeIntent } from "./domain.js";
import type { HardenedRiskPolicy } from "./config.js";

export type RiskState = {
  openExposureUsd: number;
  dailyLossUsd: number;
  consecutiveFailures: number;
  circuitBreakerUntil?: string;
  lastSnapshotAt?: string;
  lastBreakerReason?: string;
};

export class RiskEngine {
  constructor(private readonly policy: RiskPolicy) {}

  evaluate(
    signal: Signal,
    state: RiskState,
    snapshot: MarketSnapshot,
    options?: { bypassPaperFilters?: boolean },
  ): RiskDecision {
    const policy = this.normalizedPolicy();
    const now = new Date().toISOString();
    const pool = snapshot.pools.find((entry) => entry.address === signal.poolAddress);
    const isRiskExit = signal.type === "RISK_EXIT";
    const bypassPaperFilters = options?.bypassPaperFilters === true;

    if (!bypassPaperFilters && this.isBreakerActive(state)) {
      return this.reject("Circuit breaker is active", true);
    }

    if (!bypassPaperFilters && state.consecutiveFailures >= policy.circuitBreakerFailureLimit) {
      return this.reject(
        `Market-data failure streak ${state.consecutiveFailures} reached the breaker threshold`,
        true,
      );
    }

    if (!pool) {
      return this.reject("Signal pool is missing from the latest snapshot", true);
    }

    if (!bypassPaperFilters && (snapshot.pools.length === 0 || snapshot.prices.length === 0)) {
      return this.reject("Snapshot does not contain enough market data", true);
    }

    if (!bypassPaperFilters && this.isSnapshotStale(snapshot, policy.maxSnapshotAgeMs)) {
      return this.reject("Market snapshot is stale", true);
    }

    if (!bypassPaperFilters && !isRiskExit && !this.isPoolPermitted(signal.poolAddress, policy)) {
      return this.reject("Pool is blocked by allow/deny policy", false);
    }

    if (!bypassPaperFilters && !isRiskExit && !this.arePoolTokensPermitted(pool, policy)) {
      return this.reject("Pool tokens are blocked by allow/deny policy", false);
    }

    if (!bypassPaperFilters && !isRiskExit) {
      const ageReason = this.checkPoolAge(pool, policy);
      if (ageReason) {
        return this.reject(ageReason, false);
      }

      const safetyReason = this.checkPoolSafetyMetadata(pool, policy);
      if (safetyReason) {
        return this.reject(safetyReason, false);
      }
    }

    const dislocationBps = computePriceDislocationBps(pool, snapshot);
    if (!bypassPaperFilters && !isRiskExit && dislocationBps > policy.maxPriceDislocationBps) {
      return this.reject(
        `Price dislocation ${dislocationBps.toFixed(0)} bps above policy limit ${policy.maxPriceDislocationBps} bps`,
        false,
      );
    }

    if (!bypassPaperFilters && !isRiskExit && state.dailyLossUsd >= policy.capitalUsd * (policy.maxDailyLossBps / 10_000)) {
      return this.reject("Daily loss limit reached", true);
    }

    if (!bypassPaperFilters && !isRiskExit && signal.confidence < policy.minSignalConfidence) {
      return this.reject(
        `Signal confidence ${signal.confidence} below minimum ${policy.minSignalConfidence}`,
        false,
      );
    }

    const maxPositionUsd = policy.capitalUsd * (policy.maxPositionBps / 10_000);
    const maxExposureUsd = policy.capitalUsd * (policy.maxExposureBps / 10_000);
    const currentAvailable = isRiskExit ? maxPositionUsd : Math.max(0, maxExposureUsd - state.openExposureUsd);
    const cappedAmountUsd = isRiskExit
      ? Math.min(signal.suggestedCapitalUsd, maxPositionUsd)
      : Math.min(signal.suggestedCapitalUsd, maxPositionUsd, currentAvailable);

    if (cappedAmountUsd <= 0) {
      return this.reject("Exposure limit reached", false);
    }

    if (!bypassPaperFilters && !isRiskExit && signal.slippageBps > policy.maxSlippageBps) {
      return this.reject(
        `Slippage ${signal.slippageBps} bps above policy limit ${policy.maxSlippageBps} bps`,
        false,
      );
    }

    if (!bypassPaperFilters && signal.risk === "HIGH" && !isRiskExit) {
      return this.reject("Pool risk is too high for new exposure", false);
    }

    return {
      approved: true,
      reason: bypassPaperFilters
        ? `Approved in paper debug mode at ${now}`
        : `Approved at ${now} (${dislocationBps.toFixed(0)} bps dislocation)`,
      cappedAmountUsd: round2(cappedAmountUsd),
      circuitBreakerActive: false,
    };
  }

  buildIntent(signal: Signal, decision: RiskDecision, mode: TradeIntent["mode"]): TradeIntent {
    return {
      id: randomUUID(),
      signalId: signal.id,
      signalType: signal.type,
      action: signal.action,
      mode,
      poolAddress: signal.poolAddress,
      symbolIn: inferSymbolIn(signal),
      symbolOut: inferSymbolOut(signal),
      amountUsd: decision.cappedAmountUsd,
      slippageBps: signal.slippageBps,
      priorityFeeMicroLamports: signal.priorityFeeMicroLamports,
      route: signal.action === "SWAP" ? "JUPITER" : mode === "paper" ? "PAPER" : "DIRECT_POOL",
      createdAt: new Date().toISOString(),
    };
  }

  private isBreakerActive(state: RiskState) {
    return Boolean(state.circuitBreakerUntil && new Date(state.circuitBreakerUntil).getTime() > Date.now());
  }

  private normalizedPolicy(): HardenedRiskPolicy {
    const policy = this.policy as Partial<HardenedRiskPolicy>;
    return {
      capitalUsd: policy.capitalUsd ?? 0,
      maxPositionBps: policy.maxPositionBps ?? 0,
      maxExposureBps: policy.maxExposureBps ?? 0,
      maxSlippageBps: policy.maxSlippageBps ?? 0,
      maxDailyLossBps: policy.maxDailyLossBps ?? 0,
      minSignalConfidence: policy.minSignalConfidence ?? 0,
      maxConcurrentIntents: policy.maxConcurrentIntents ?? 1,
      maxPriceDislocationBps: policy.maxPriceDislocationBps ?? Number.POSITIVE_INFINITY,
      maxPoolAgeHours: policy.maxPoolAgeHours,
      requireVerifiedPoolMetadata: policy.requireVerifiedPoolMetadata ?? false,
      poolAllowlist: policy.poolAllowlist ?? [],
      poolDenylist: policy.poolDenylist ?? [],
      tokenAllowlist: policy.tokenAllowlist ?? [],
      tokenDenylist: policy.tokenDenylist ?? [],
      maxSnapshotAgeMs: policy.maxSnapshotAgeMs ?? Number.POSITIVE_INFINITY,
      circuitBreakerFailureLimit: policy.circuitBreakerFailureLimit ?? 3,
      circuitBreakerCooldownMs: policy.circuitBreakerCooldownMs ?? 15 * 60_000,
    };
  }

  private isSnapshotStale(snapshot: MarketSnapshot, maxSnapshotAgeMs: number) {
    const capturedAt = new Date(snapshot.capturedAt).getTime();
    if (!Number.isFinite(capturedAt)) return true;
    return Date.now() - capturedAt > maxSnapshotAgeMs;
  }

  private isPoolPermitted(poolAddress: string, policy: HardenedRiskPolicy) {
    if (policy.poolDenylist.includes(poolAddress)) return false;
    if (policy.poolAllowlist.length > 0 && !policy.poolAllowlist.includes(poolAddress)) return false;
    return true;
  }

  private arePoolTokensPermitted(pool: { tokenX: string; tokenY: string }, policy: HardenedRiskPolicy) {
    const tokenSet = [pool.tokenX, pool.tokenY];

    if (tokenSet.some((token) => policy.tokenDenylist.includes(token))) return false;
    if (policy.tokenAllowlist.length > 0 && !tokenSet.every((token) => policy.tokenAllowlist.includes(token))) {
      return false;
    }

    return true;
  }

  private checkPoolAge(
    pool: { createdAt?: string },
    policy: HardenedRiskPolicy,
  ): string | undefined {
    if (!policy.maxPoolAgeHours) return undefined;
    if (!pool.createdAt) return "Pool age could not be verified";

    const createdAt = new Date(pool.createdAt).getTime();
    if (!Number.isFinite(createdAt)) return "Pool age could not be verified";

    const maxAgeMs = policy.maxPoolAgeHours * 60 * 60 * 1000;
    if (Date.now() - createdAt > maxAgeMs) {
      return `Pool is older than the allowed ${policy.maxPoolAgeHours} hour limit`;
    }

    return undefined;
  }

  private checkPoolSafetyMetadata(
    pool: {
      mintAuthorityRevoked?: boolean;
      freezeAuthorityRevoked?: boolean;
      liquidityLocked?: boolean;
    },
    policy: HardenedRiskPolicy,
  ): string | undefined {
    if (policy.requireVerifiedPoolMetadata) {
      if (pool.mintAuthorityRevoked !== true || pool.freezeAuthorityRevoked !== true || pool.liquidityLocked !== true) {
        return "Pool safety metadata is incomplete or unverified";
      }
      return undefined;
    }

    if (pool.mintAuthorityRevoked === false) return "Pool mint authority has not been revoked";
    if (pool.freezeAuthorityRevoked === false) return "Pool freeze authority has not been revoked";
    if (pool.liquidityLocked === false) return "Pool liquidity is not locked";

    return undefined;
  }

  private reject(reason: string, circuitBreakerActive: boolean): RiskDecision {
    return { approved: false, reason, cappedAmountUsd: 0, circuitBreakerActive };
  }
}

export function computePriceDislocationBps(
  pool: { tokenX: string; tokenY: string; currentPrice: number },
  snapshot: MarketSnapshot,
) {
  const priceX = findPrice(snapshot.prices, pool.tokenX);
  const priceY = findPrice(snapshot.prices, pool.tokenY);
  const current = pool.currentPrice;

  if (current <= 0 || priceX <= 0 || priceY <= 0) return 0;

  const candidates = [priceX / priceY, priceY / priceX].filter((value) => Number.isFinite(value) && value > 0);
  if (candidates.length === 0) return 0;

  return Math.min(...candidates.map((expected) => Math.abs(current - expected) / expected * 10_000));
}

function findPrice(prices: MarketSnapshot["prices"], symbol: string) {
  return prices.find((entry) => entry.symbol === symbol)?.price ?? 0;
}

function inferSymbolIn(signal: Signal) {
  if (signal.action === "SWAP") return "SOL";
  return undefined;
}

function inferSymbolOut(signal: Signal) {
  if (signal.action === "SWAP") return "USDC";
  return undefined;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
