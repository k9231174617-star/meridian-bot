import test from "node:test";
import assert from "node:assert/strict";
import { buildAnalyticsSummary, buildPnlHistory } from "./analytics";

test("analytics summary derives totals from positions", () => {
  const summary = buildAnalyticsSummary([
    { total_fee_usd_claimed: "12.5" },
    { total_fee_usd_claimed: "0" },
    { total_fee_usd_claimed: "8.25" },
  ]);

  assert.equal(summary.totalTrades, 3);
  assert.equal(summary.totalFeesEarned, 20.75);
  assert.equal(summary.totalPnlUsd, 20.75);
  assert.equal(summary.winRate, 66.7);
  assert.equal(summary.pnlHistory.length, 14);
});

test("pnl history is deterministic and monotonic enough for charts", () => {
  const first = buildPnlHistory(42.5, 8.75);
  const second = buildPnlHistory(42.5, 8.75);

  assert.deepEqual(first, second);
  assert.equal(first.length, 14);
  assert.ok(first.at(-1)!.pnl >= first[0].pnl);
});
