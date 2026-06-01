import assert from "node:assert/strict";
import test from "node:test";
import { matchKeywords } from "./pool-watcher.js";

test("pool watcher keyword matching is case insensitive", () => {
  const keywords = matchKeywords([
    "Program log: initialize_pool",
    "Program log: Raydium createPool",
    "Program log: something else",
  ], ["initialize", "create_pool", "raydium"]);

  assert.deepEqual(keywords.sort(), ["create_pool", "initialize", "raydium"].sort());
});
