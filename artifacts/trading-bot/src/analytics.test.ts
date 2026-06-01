import assert from "node:assert/strict";
import test from "node:test";
import { calculateImpermanentLossPct, calculateImpermanentLossUsd, calculateRoundTripLossBps } from "./analytics.js";

test("impermanent loss formula returns expected loss for 2x move", () => {
  const lossPct = calculateImpermanentLossPct(1, 2);
  assert.ok(lossPct < 0);
  assert.ok(Math.abs(lossPct - (-0.057190958)) < 1e-6);
});

test("impermanent loss usd uses absolute percentage", () => {
  assert.ok(Math.abs(calculateImpermanentLossUsd(1000, 1, 2) - 57.190958) < 1e-6);
});

test("round trip loss bps handles ratios", () => {
  assert.equal(calculateRoundTripLossBps(100, 96), 400);
});
