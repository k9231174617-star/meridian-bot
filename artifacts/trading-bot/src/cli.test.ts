import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "./config.js";

test("config loads sane defaults", () => {
  const config = loadConfig({});
  assert.equal(config.mode, "paper");
  assert.equal(config.provider, "direct");
  assert.ok(config.risk.capitalUsd > 0);
});
