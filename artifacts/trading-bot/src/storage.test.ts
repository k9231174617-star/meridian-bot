import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createStorage } from "./storage.js";

const config = {
  mode: "paper",
  provider: "direct",
  marketDataBaseUrl: "http://127.0.0.1:8081/api",
  intervalMs: 15_000,
  risk: {
    capitalUsd: 10_000,
    maxPositionBps: 500,
    maxExposureBps: 2_000,
    maxSlippageBps: 75,
    maxDailyLossBps: 300,
    minSignalConfidence: 0.6,
    maxConcurrentIntents: 3,
  },
} as const;

test("file storage persists snapshots and alerts locally", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "trading-bot-storage-"));
  const storage = await createStorage(undefined, { storageDir: dir });

  assert.ok(storage);

  const startedAt = new Date().toISOString();
  const runId = await storage.saveRunStart(config as never, startedAt);
  assert.equal(runId, 1);

  const snapshot = {
    capturedAt: startedAt,
    pools: [],
    prices: [],
  };

  await storage.saveSnapshot(snapshot as never);
  await storage.saveAlert({
    severity: "warning",
    title: "Snapshot missing",
    message: "No pools were present",
    createdAt: startedAt,
  });

  assert.deepEqual(await storage.loadLastSnapshot(), snapshot);
  assert.equal(await storage.loadSignal("missing"), null);
  assert.equal(await storage.loadIntent("missing"), null);
  assert.equal(await storage.loadExecutionByIntentId("missing"), null);

  const alerts = await readFile(path.join(dir, "alerts.jsonl"), "utf8");
  assert.match(alerts, /Snapshot missing/);
});
