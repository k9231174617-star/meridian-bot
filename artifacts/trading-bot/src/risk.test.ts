import assert from "node:assert/strict";
import test from "node:test";
import { RiskEngine } from "./risk.js";

const policy = {
  capitalUsd: 10_000,
  maxPositionBps: 500,
  maxExposureBps: 2000,
  maxSlippageBps: 75,
  maxDailyLossBps: 300,
  minSignalConfidence: 0.6,
  maxConcurrentIntents: 3,
  maxPriceDislocationBps: 1_000,
  maxPoolAgeHours: 48,
  requireVerifiedPoolMetadata: false,
  poolAllowlist: [],
  poolDenylist: [],
  tokenAllowlist: [],
  tokenDenylist: [],
};

test("risk engine caps size and rejects low confidence", () => {
  const engine = new RiskEngine(policy);
  const signal = {
    id: "signal-1",
    type: "FEE_MOMENTUM",
    action: "ADD_LIQUIDITY",
    poolAddress: "pool-1",
    poolName: "SOL-USDC",
    risk: "LOW",
    confidence: 0.4,
    severity: 70,
    reason: [],
    suggestedCapitalUsd: 1_000,
    slippageBps: 50,
    priorityFeeMicroLamports: 1_500,
    createdAt: "2026-05-31T00:00:00.000Z",
  } as const;
  const snapshot = { capturedAt: "2026-05-31T00:00:00.000Z", pools: [1], prices: [] } as never;
  const decision = engine.evaluate(signal as never, { openExposureUsd: 0, dailyLossUsd: 0, consecutiveFailures: 0 }, snapshot);

  assert.equal(decision.approved, false);
});

test("risk engine rejects pools outside allowlists and excessive dislocation", () => {
  const engine = new RiskEngine({
    ...policy,
    poolAllowlist: ["pool-allow"],
    tokenAllowlist: ["SOL", "USDC"],
    poolDenylist: ["pool-block"],
    tokenDenylist: ["SCAM"],
    maxPriceDislocationBps: 500,
    maxSnapshotAgeMs: 10_000,
    circuitBreakerFailureLimit: 3,
    circuitBreakerCooldownMs: 15 * 60_000,
  } as never);

  const signal = {
    id: "signal-2",
    type: "FEE_MOMENTUM",
    action: "ADD_LIQUIDITY",
    poolAddress: "pool-allow",
    poolName: "SOL-USDC",
    risk: "LOW",
    confidence: 0.95,
    severity: 70,
    reason: [],
    suggestedCapitalUsd: 1_000,
    slippageBps: 50,
    priorityFeeMicroLamports: 1_500,
    createdAt: "2026-05-31T00:00:00.000Z",
  } as const;

  const snapshot = {
    capturedAt: new Date().toISOString(),
    pools: [
      {
        address: "pool-allow",
        name: "SOL-USDC",
        tokenX: "SOL",
        tokenY: "USDC",
        tvlUsd: 1_000_000,
        volume24hUsd: 2_000_000,
        fee24hUsd: 10_000,
        feeRatePct: 1,
        binStep: 4,
        signalScore: 84,
        jupScore: 86,
        smartMoneyScore: 74,
        ilRisk: "LOW",
        signalSeed: "ENTER",
        currentPrice: 300,
        activeBinId: 12,
        createdAt: "2026-05-31T00:00:00.000Z",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
      },
    ],
    prices: [
      { symbol: "SOL", price: 150, change24h: 0.5 },
      { symbol: "USDC", price: 1, change24h: 0 },
    ],
  } as const;

  const decision = engine.evaluate(signal as never, { openExposureUsd: 0, dailyLossUsd: 0, consecutiveFailures: 0 }, snapshot as never);

  assert.equal(decision.approved, false);
  assert.match(decision.reason, /dislocation/i);
});

test("risk engine rejects pools that are too old or unverifiable", () => {
  const engine = new RiskEngine({
    ...policy,
    maxPoolAgeHours: 1,
    requireVerifiedPoolMetadata: true,
    maxSnapshotAgeMs: 10_000,
    circuitBreakerFailureLimit: 3,
    circuitBreakerCooldownMs: 15 * 60_000,
  } as never);

  const signal = {
    id: "signal-3",
    type: "FEE_MOMENTUM",
    action: "ADD_LIQUIDITY",
    poolAddress: "pool-old",
    poolName: "SOL-USDC",
    risk: "LOW",
    confidence: 0.95,
    severity: 50,
    reason: [],
    suggestedCapitalUsd: 1_000,
    slippageBps: 50,
    priorityFeeMicroLamports: 1_500,
    createdAt: "2026-05-31T00:00:00.000Z",
  } as const;

  const snapshot = {
    capturedAt: new Date().toISOString(),
    pools: [
      {
        address: "pool-old",
        name: "SOL-USDC",
        tokenX: "SOL",
        tokenY: "USDC",
        tvlUsd: 1_000_000,
        volume24hUsd: 2_000_000,
        fee24hUsd: 10_000,
        feeRatePct: 1,
        binStep: 4,
        signalScore: 84,
        jupScore: 86,
        smartMoneyScore: 74,
        ilRisk: "LOW",
        signalSeed: "ENTER",
        currentPrice: 170,
        activeBinId: 12,
        createdAt: "2024-01-01T00:00:00.000Z",
        mintAuthorityRevoked: false,
        freezeAuthorityRevoked: false,
        liquidityLocked: false,
      },
    ],
    prices: [
      { symbol: "SOL", price: 170, change24h: 0.5 },
      { symbol: "USDC", price: 1, change24h: 0 },
    ],
  } as const;

  const decision = engine.evaluate(signal as never, { openExposureUsd: 0, dailyLossUsd: 0, consecutiveFailures: 0 }, snapshot as never);

  assert.equal(decision.approved, false);
  assert.match(decision.reason, /safety|old|unverified/i);
});
