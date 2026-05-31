import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPriceResponse,
  normalizePriceTokens,
  TOKEN_MINTS,
} from "./prices";

test("normalizePriceTokens trims and uppercases tokens", () => {
  assert.deepEqual(normalizePriceTokens(" sol, usdc ,jup "), ["SOL", "USDC", "JUP"]);
});

test("buildPriceResponse returns zero change when no historical data exists", () => {
  const result = buildPriceResponse(["SOL", "USDC"], {
    [TOKEN_MINTS.SOL]: { price: "161.22" },
    [TOKEN_MINTS.USDC]: { price: "1" },
  });

  assert.equal(result.prices.SOL.price, 161.22);
  assert.equal(result.prices.SOL.change24h, 0);
  assert.equal(result.prices.USDC.price, 1);
});
