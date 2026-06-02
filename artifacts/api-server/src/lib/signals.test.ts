import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadRecentSignals } from "./signals.js";

test("loadRecentSignals returns newest signals first", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "signal-feed-"));
  await writeFile(
    path.join(dir, "signals.jsonl"),
    [
      JSON.stringify({ kind: "signal", signal: { id: "sig-1", type: "RUG_SHIELD", action: "REMOVE_LIQUIDITY", poolAddress: "pool-1", poolName: "POOL 1", risk: "HIGH", confidence: 0.99, severity: 100, reason: ["test"], suggestedCapitalUsd: 100, slippageBps: 25, priorityFeeMicroLamports: 2000, createdAt: "2026-06-01T00:00:00.000Z" } }),
      JSON.stringify({ kind: "signal", signal: { id: "sig-2", type: "SOCIAL_VELOCITY", action: "ADD_LIQUIDITY", poolAddress: "pool-2", poolName: "POOL 2", risk: "MEDIUM", confidence: 0.91, severity: 88, reason: ["test"], suggestedCapitalUsd: 120, slippageBps: 35, priorityFeeMicroLamports: 1800, createdAt: "2026-06-01T00:01:00.000Z" } }),
    ].join("\n"),
    "utf8",
  );

  const feed = await loadRecentSignals(dir, 10);

  assert.equal(feed.total, 2);
  assert.equal(feed.signals[0]?.id, "sig-2");
  assert.equal(feed.signals[1]?.id, "sig-1");
  assert.equal(feed.counts.SOCIAL_VELOCITY, 1);
  assert.equal(feed.counts.RUG_SHIELD, 1);
});
