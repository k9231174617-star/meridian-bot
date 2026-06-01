import assert from "node:assert/strict";
import test from "node:test";
import { SignalEngine } from "./signals.js";

const snapshot = {
  capturedAt: "2026-05-31T00:00:00.000Z",
  pools: [
    {
      address: "pool-1",
      name: "SOL-USDC",
      tokenX: "SOL",
      tokenY: "USDC",
      tvlUsd: 2_000_000,
      volume24hUsd: 4_000_000,
      fee24hUsd: 20_000,
      feeRatePct: 1,
      binStep: 4,
      signalScore: 84,
      jupScore: 86,
      smartMoneyScore: 74,
      ilRisk: "LOW",
      signalSeed: "ENTER",
      currentPrice: 172,
      activeBinId: 12,
    },
    {
      address: "pool-2",
      name: "MEME-USDC",
      tokenX: "MEME",
      tokenY: "USDC",
      tvlUsd: 50_000,
      volume24hUsd: 1_000,
      fee24hUsd: 5,
      feeRatePct: 0.01,
      binStep: 80,
      signalScore: 22,
      jupScore: 20,
      smartMoneyScore: 24,
      ilRisk: "HIGH",
      signalSeed: "AVOID",
      currentPrice: 0.01,
      activeBinId: 2,
    },
  ],
  prices: [],
} as const;

test("signal engine prioritizes healthy pools and exits risky ones", () => {
  const engine = new SignalEngine();
  const result = engine.generate({ now: snapshot as never });

  assert.equal(result.length, 2);
  assert.ok(result[0]?.id.startsWith("sig_"));
  assert.equal(result[0]?.poolAddress, "pool-2");
  assert.equal(result[0]?.action, "REMOVE_LIQUIDITY");
  assert.equal(result[1]?.action, "ADD_LIQUIDITY");
});
