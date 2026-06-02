import { strict as assert } from "node:assert";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SelfLearningLoop } from "./self-learning-loop.js";
import type { MarketSnapshot, Signal, TradeIntent, ExecutionResult } from "../domain.js";

function buildSnapshot(): MarketSnapshot {
  return {
    capturedAt: new Date().toISOString(),
    prices: [{ symbol: "SOL", price: 180, change24h: 4 }],
    pools: [
      {
        address: "pool_1",
        name: "Test Pool",
        tokenX: "TOKEN",
        tokenY: "SOL",
        tvlUsd: 120_000,
        volume24hUsd: 80_000,
        fee24hUsd: 900,
        feeRatePct: 0.55,
        binStep: 25,
        signalScore: 84,
        jupScore: 72,
        smartMoneyScore: 68,
        ilRisk: "LOW",
        signalSeed: "ENTER",
        currentPrice: 1.2,
        activeBinId: 420,
      },
    ],
  };
}

function buildSignal(): Signal {
  return {
    id: "sig_1",
    type: "TICK_RANGE_PROPHET",
    action: "ADD_LIQUIDITY",
    poolAddress: "pool_1",
    poolName: "Test Pool",
    risk: "LOW",
    confidence: 0.88,
    severity: 80,
    reason: ["test"],
    suggestedCapitalUsd: 250,
    slippageBps: 35,
    priorityFeeMicroLamports: 1_500,
    executionHints: {
      splitCount: 2,
      minDelayMs: 0,
      maxDelayMs: 120,
      priorityProtection: "HIGH",
      routeAuction: {
        preferredRoute: "JUPITER",
        candidates: ["JUPITER", "DIRECT_POOL"],
        simulationBudgetMs: 75,
      },
      tickRange: {
        lowerBinId: 400,
        upperBinId: 440,
        centerBinId: 420,
        horizonMinutes: 15,
        confidence: 0.7,
        predictedMoveBps: 120,
      },
    },
    createdAt: new Date().toISOString(),
  };
}

test("self learning loop records open and close state", async () => {
  const storageDir = await mkdtemp(path.join(os.tmpdir(), "meridian-learning-"));
  const loop = new SelfLearningLoop({ storageDir });
  await loop.start();

  const snapshot = buildSnapshot();
  const signal = buildSignal();
  const intent: TradeIntent = {
    id: "intent_1",
    signalId: signal.id,
    signalType: signal.type,
    action: signal.action,
    mode: "paper",
    poolAddress: signal.poolAddress,
    amountUsd: 250,
    slippageBps: signal.slippageBps,
    priorityFeeMicroLamports: signal.priorityFeeMicroLamports,
    route: "PAPER",
    createdAt: new Date().toISOString(),
  };
  const execution: ExecutionResult = {
    intentId: intent.id,
    status: "filled",
    filledUsd: 240,
    feesUsd: 1.5,
    slippageUsd: 0.5,
    executedAt: new Date().toISOString(),
  };
  const plan = loop.selectPlan({ signal, snapshot });
  const plannedSignal = loop.applyPlan(signal, plan);

  loop.recordPositionOpen({ intent, signal: plannedSignal, snapshot, plan });
  loop.recordPositionClose({ intent, execution, signal: plannedSignal, snapshot, pool: snapshot.pools[0] });

  const state = loop.getState();
  assert.equal(state.completedTradeCount, 1);
  assert.ok(state.bandit.global[plan.strategy].n >= 1);

  await loop.stop();
  await rm(storageDir, { recursive: true, force: true });
});
