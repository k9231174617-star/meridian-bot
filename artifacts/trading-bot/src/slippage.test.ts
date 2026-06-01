import assert from "node:assert/strict";
import test from "node:test";
import { recommendDynamicSlippageBps } from "./slippage.js";

test("dynamic slippage respects tighter caps for deep pools", () => {
  const bps = recommendDynamicSlippageBps({
    address: "pool",
    name: "SOL-USDC",
    tokenX: "SOL",
    tokenY: "USDC",
    tvlUsd: 10_000_000,
    volume24hUsd: 12_000_000,
    fee24hUsd: 25_000,
    feeRatePct: 0.25,
    binStep: 1,
    signalScore: 80,
    jupScore: 80,
    smartMoneyScore: 80,
    ilRisk: "LOW",
    signalSeed: "ENTER",
    currentPrice: 1,
    activeBinId: 0,
  }, "SWAP", 50, 1000, 75);

  assert.ok(bps <= 75);
  assert.ok(bps >= 10);
});

test("dynamic slippage expands for shallow add-liquidity actions", () => {
  const bps = recommendDynamicSlippageBps({
    address: "pool",
    name: "SOL-XYZ",
    tokenX: "SOL",
    tokenY: "XYZ",
    tvlUsd: 50_000,
    volume24hUsd: 10_000,
    fee24hUsd: 100,
    feeRatePct: 0.2,
    binStep: 50,
    signalScore: 35,
    jupScore: 20,
    smartMoneyScore: 20,
    ilRisk: "HIGH",
    signalSeed: "AVOID",
    currentPrice: 1,
    activeBinId: 0,
  }, "ADD_LIQUIDITY", 60, 20_000, 150);

  assert.ok(bps <= 150);
  assert.ok(bps >= 10);
});
