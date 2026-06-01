import assert from "node:assert/strict";
import test from "node:test";
import { BotMetrics } from "./observability.js";

test("bot metrics track lifecycle, alerts, and rejections", () => {
  const metrics = new BotMetrics();
  const startedAt = "2026-06-01T00:00:00.000Z";
  const endedAt = "2026-06-01T00:05:00.000Z";

  metrics.recordRunStart(startedAt);
  metrics.recordCycle(startedAt);
  metrics.recordAlert({
    severity: "warning",
    title: "Test alert",
    message: "Warning",
    createdAt: startedAt,
  });
  metrics.recordRejection("Pool is blocked by allow/deny policy");
  metrics.recordExecution({
    intentId: "intent-1",
    status: "simulated",
    filledUsd: 100,
    feesUsd: 1,
    slippageUsd: 2,
    executedAt: endedAt,
  });
  metrics.recordRunFinish("completed", endedAt);

  const telemetry = metrics.telemetrySnapshot();
  const summary = metrics.snapshot();

  assert.equal(telemetry.status, "completed");
  assert.equal(telemetry.alerts.total, 1);
  assert.equal(telemetry.alerts.warning, 1);
  assert.equal(telemetry.rejections["Pool is blocked by allow/deny policy"], 1);
  assert.equal(summary.cycles, 1);
  assert.equal(summary.fills, 1);
});
