import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadBacktestSnapshots, parseBacktestSnapshots } from "./backtest-data.js";

const snapshot = {
  capturedAt: "2026-06-01T00:00:00.000Z",
  pools: [
    {
      address: "pool-1",
      name: "SOL-USDC",
      tokenX: "SOL",
      tokenY: "USDC",
      tvlUsd: 1000,
      volume24hUsd: 500,
      fee24hUsd: 10,
      feeRatePct: 1,
      binStep: 4,
      signalScore: 80,
      jupScore: 85,
      smartMoneyScore: 70,
      ilRisk: "LOW",
      signalSeed: "ENTER",
      currentPrice: 1,
      activeBinId: 1,
    },
  ],
  prices: [{ symbol: "SOL", price: 100, change24h: 1 }],
};

test("parseBacktestSnapshots supports json arrays", () => {
  const parsed = parseBacktestSnapshots(JSON.stringify([snapshot]));
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.capturedAt, snapshot.capturedAt);
});

test("loadBacktestSnapshots supports jsonl files", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "trading-bot-backtest-"));
  const file = path.join(dir, "snapshots.jsonl");
  await writeFile(file, `${JSON.stringify(snapshot)}\n`, "utf8");

  const parsed = await loadBacktestSnapshots(file);
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.pools[0]?.address, "pool-1");
});
