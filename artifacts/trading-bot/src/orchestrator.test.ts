import test from "node:test";
import assert from "node:assert/strict";
import { BotOrchestrator } from "./orchestrator.js";
import type { MarketSnapshot } from "./domain.js";
import { eventBus } from "./streams/event-bus.js";

function buildSnapshot(overrides: Partial<MarketSnapshot["pools"][number]> = {}): MarketSnapshot {
  return {
    capturedAt: "2026-06-02T00:00:00.000Z",
    prices: [],
    pools: [
      {
        address: "pool-1",
        name: "POOL-1",
        tokenX: "TOKEN-A",
        tokenY: "USDC",
        tvlUsd: 1_000,
        volume24hUsd: 100,
        fee24hUsd: 10,
        feeRatePct: 0.3,
        binStep: 1,
        signalScore: 42,
        jupScore: 51,
        smartMoneyScore: 47,
        ilRisk: "LOW",
        signalSeed: "WATCH",
        currentPrice: 1,
        activeBinId: 10,
        ...overrides,
      },
    ],
  };
}

test("orchestrator emits snapshot-derived pool events", async () => {
  const orchestrator = new BotOrchestrator({
    enabled: true,
    enableWssPoolWatcher: false,
    enableGeyser: false,
  });

  const events: string[] = [];
  const stop = await orchestrator.start({
    onPoolNew: (event) => {
      events.push(event.type);
    },
    onPoolTvlDrop: (event) => {
      events.push(event.type);
    },
    onTokenMigrate: (event) => {
      events.push(event.type);
    },
  });

  orchestrator.ingestSnapshot(buildSnapshot(), undefined, []);
  orchestrator.ingestSnapshot(
    buildSnapshot({
      tvlUsd: 600,
      volume24hUsd: 400,
      fee24hUsd: 20,
      eventWindowActive: true,
      bondingCurveProgressPct: 98,
      migrateTarget: "RAYDIUM",
    }),
    buildSnapshot(),
    [],
  );

  await stop();

  assert.ok(events.includes("pool:new"));
  assert.ok(events.includes("pool:tvl_drop"));
  assert.ok(events.includes("token:migrate"));
});

test("orchestrator consumes stream events from the event bus", async () => {
  const orchestrator = new BotOrchestrator({
    enabled: true,
    enableWssPoolWatcher: false,
    enableGeyser: false,
  });

  const events: string[] = [];
  const stop = await orchestrator.start({
    onPoolNew: (event) => {
      events.push(event.type);
    },
  });

  eventBus.emit("pool:new", {
    type: "pool:new",
    ts: Date.now(),
    poolAddress: "pool-raw",
    data: {
      source: "wss",
      signature: "sig-1",
      detectedAt: "2026-06-02T00:00:00.000Z",
      keywords: ["create"],
      logs: ["create"],
      dexes: ["raydium"],
      programIds: ["program-1"],
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  await stop();

  assert.ok(events.includes("pool:new"));
});

test("orchestrator routes pool events into strategy directives", async () => {
  const orchestrator = new BotOrchestrator({
    enabled: true,
    enableWssPoolWatcher: false,
    enableGeyser: false,
  });

  const strategyEvents: string[] = [];
  const stop = await orchestrator.start({
    onStrategyTriggered: (event) => {
      strategyEvents.push(String(event.data.strategy));
    },
  });

  orchestrator.ingestSnapshot(buildSnapshot(), undefined, []);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await stop();

  assert.ok(strategyEvents.includes("TICK_RANGE_PROPHET"));
});

test("orchestrator routes mempool and smart-money events into new strategies", async () => {
  const orchestrator = new BotOrchestrator({
    enabled: true,
    enableWssPoolWatcher: false,
    enableGeyser: false,
  });

  const strategyEvents: string[] = [];
  const stop = await orchestrator.start({
    onStrategyTriggered: (event) => {
      strategyEvents.push(String(event.data.strategy));
    },
  });

  eventBus.emit("mempool:large_buy", {
    type: "mempool:large_buy",
    ts: Date.now(),
    poolAddress: "pool-mempool",
    tokenMint: "TOKEN-M",
    walletAddress: "wallet-mempool",
    data: {
      source: "geyser",
      sizeUsd: 250_000,
      estimatedUsd: 250_000,
      confidence: 0.92,
    },
  });

  eventBus.emit("smart_money:cluster", {
    type: "smart_money:cluster",
    ts: Date.now(),
    poolAddress: "pool-smart",
    data: {
      source: "geyser",
      clusterScore: 78,
      relatedPools: ["pool-smart-peer"],
      smartWallets: ["wallet-a", "wallet-b", "wallet-c"],
      confidence: 0.86,
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 10));
  await stop();

  assert.ok(strategyEvents.includes("PREDICTIVE_REBALANCE"));
  assert.ok(strategyEvents.includes("SMART_MONEY_SHADOW"));
});
