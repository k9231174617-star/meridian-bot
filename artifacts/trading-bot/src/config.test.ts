import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { loadConfig, parseCsvList, resolveSignerSecretKey } from "./config.js";

test("parseCsvList trims and deduplicates entries", () => {
  assert.deepEqual(parseCsvList("SOL, USDC, SOL, JUP "), ["SOL", "USDC", "JUP"]);
});

test("config loads allowlists and secret file path", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "trading-bot-config-"));
  const secretPath = path.join(dir, "secret.json");
  await writeFile(secretPath, " [1,2,3] \n", "utf8");

  const config = loadConfig({
    BOT_ALLOWED_POOL_ADDRESSES: "pool-a, pool-b",
    BOT_DENIED_POOL_ADDRESSES: "pool-z",
    BOT_ALLOWED_TOKENS: "SOL,USDC",
    BOT_DENIED_TOKENS: "SCAM",
    BOT_SIGNER_SECRET_KEY_FILE: secretPath,
  });

  const risk = config.risk as unknown as {
    poolAllowlist: string[];
    poolDenylist: string[];
    tokenAllowlist: string[];
    tokenDenylist: string[];
  };

  assert.deepEqual(risk.poolAllowlist, ["pool-a", "pool-b"]);
  assert.deepEqual(risk.poolDenylist, ["pool-z"]);
  assert.deepEqual(risk.tokenAllowlist, ["SOL", "USDC"]);
  assert.deepEqual(risk.tokenDenylist, ["SCAM"]);

  await assert.doesNotReject(resolveSignerSecretKey(config));
  assert.equal(await resolveSignerSecretKey(config), "[1,2,3]");
});

test("config exposes pool age and verification flags", () => {
  const config = loadConfig({
    BOT_MAX_POOL_AGE_HOURS: "24",
    BOT_REQUIRE_VERIFIED_POOL_METADATA: "true",
  });

  assert.equal(config.risk.maxPoolAgeHours, 24);
  assert.equal(config.risk.requireVerifiedPoolMetadata, true);
});
