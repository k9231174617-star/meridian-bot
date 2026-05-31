import test from "node:test";
import assert from "node:assert/strict";
import {
  computeIlRisk,
  computeJupScore,
  computeSignalType,
  computeSmartMoneyScore,
  enrichPool,
} from "./pools";

test("pool scoring prefers deep, active pools", () => {
  const score = computeJupScore(2_500_000, 5_500_000, 2.5, 4);
  assert.ok(score >= 80);
  assert.equal(computeSignalType(score), "ENTER");
});

test("smart money score is deterministic", () => {
  const first = computeSmartMoneyScore(1_500_000, 2_400_000, 1.4);
  const second = computeSmartMoneyScore(1_500_000, 2_400_000, 1.4);

  assert.equal(first, second);
  assert.ok(first >= 50);
});

test("il risk is lower for stables and narrow bins", () => {
  assert.equal(computeIlRisk(4, "USDC"), "LOW");
  assert.equal(computeIlRisk(40, "SOL"), "HIGH");
});

test("enrichPool normalizes Meteora pool fields", () => {
  const pool = enrichPool({
    address: "pool-address",
    name: "SOL-USDC",
    liquidity: "1250000",
    trade_volume_24h: "2750000",
    fees_24h: "24500",
    bin_step: "4",
    current_price: "162.55",
    active_id: "321",
  });

  assert.equal(pool.address, "pool-address");
  assert.equal(pool.tokenX, "SOL");
  assert.equal(pool.tokenY, "USDC");
  assert.equal(pool.ilRisk, "LOW");
  assert.equal(pool.signalType, "ENTER");
});
