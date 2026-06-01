import assert from "node:assert/strict";
import test from "node:test";
import { runBacktest } from "./backtest.js";

const snapshots = [0, 1, 2].map((index) => ({
  capturedAt: `2026-05-31T0${index}:00:00.000Z`,
  pools: [
    {
      address: "pool-1",
      name: "SOL-USDC",
      tokenX: "SOL",
      tokenY: "USDC",
      tvlUsd: 1_000_000 + index * 100_000,
      volume24hUsd: 2_000_000 + index * 250_000,
      fee24hUsd: 10_000 + index * 1_000,
      feeRatePct: 1,
      binStep: 4,
      signalScore: 84,
      jupScore: 86,
      smartMoneyScore: 74,
      ilRisk: "LOW",
      signalSeed: "ENTER",
      currentPrice: 170 + index,
      activeBinId: 12,
    },
  ],
  prices: [],
}));

test("backtest returns metrics", async () => {
  const metrics = await runBacktest(
    {
      mode: "paper",
      provider: "direct",
      marketDataBaseUrl: "http://127.0.0.1:8081/api",
      intervalMs: 1000,
      paperDebugForceSignal: false,
      paperDebugBypassRisk: false,
      risk: {
        capitalUsd: 10_000,
        maxPositionBps: 500,
        maxExposureBps: 2_000,
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
        maxSnapshotAgeMs: 120_000,
        circuitBreakerFailureLimit: 3,
        circuitBreakerCooldownMs: 15 * 60_000,
      },
    },
    snapshots as never,
  );

  assert.equal(metrics.cycles, 3);
  assert.ok(metrics.signals >= 1);
});
