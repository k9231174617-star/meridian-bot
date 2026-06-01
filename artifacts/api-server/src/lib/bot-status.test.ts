import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadBotStatus } from "./bot-status.js";

test("loadBotStatus reads last run and recent alerts", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bot-status-"));
  await writeFile(
    path.join(dir, "runs.jsonl"),
    [
      JSON.stringify({ kind: "run_start", runId: 1, startedAt: "2026-06-01T00:00:00.000Z", config: { mode: "live", provider: "direct" } }),
      JSON.stringify({ kind: "run_finish", runId: 1, status: "completed", summary: { snapshots: 3, signals: 1, approved: 1, fills: 1, executions: 1 }, endedAt: "2026-06-01T00:01:00.000Z" }),
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(dir, "alerts.jsonl"),
    [
      JSON.stringify({ kind: "alert", alert: { severity: "warning", title: "A", message: "B", createdAt: "2026-06-01T00:00:01.000Z" } }),
      JSON.stringify({ kind: "alert", alert: { severity: "critical", title: "C", message: "D", createdAt: "2026-06-01T00:00:02.000Z" } }),
    ].join("\n"),
    "utf8",
  );

  const status = await loadBotStatus(dir);
  assert.equal(status.lastRun?.runId, 1);
  assert.equal(status.lastRun?.status, "completed");
  assert.equal(status.lastRun?.mode, "live");
  assert.equal(status.lastRun?.provider, "direct");
  assert.equal(status.lastRun?.summary?.snapshots, 3);
  assert.equal(status.lastRun?.summary?.executions, 1);
  assert.equal(status.totals.runsStarted, 1);
  assert.equal(status.totals.runsFinished, 1);
  assert.equal(status.totals.alerts, 2);
  assert.equal(status.totals.alertsBySeverity.warning, 1);
  assert.equal(status.totals.alertsBySeverity.critical, 1);
  assert.equal(status.recentAlerts.length, 2);
  assert.equal(status.recentAlerts[1]?.severity, "critical");
});
