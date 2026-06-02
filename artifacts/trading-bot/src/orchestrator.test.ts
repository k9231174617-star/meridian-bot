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
