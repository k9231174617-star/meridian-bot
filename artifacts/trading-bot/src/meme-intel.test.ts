import assert from "node:assert/strict";
import test from "node:test";
import { MemeIntelService } from "./meme-intel.js";

test("meme intel service enriches pools with degen and whale metrics", async () => {
  const service = new MemeIntelService();
  const snapshot = {
    capturedAt: "2026-05-31T00:00:00.000Z",
    pools: [
      {
        address: "pool-1",
        name: "MEME-USDC",
        tokenX: "MEME",
        tokenY: "USDC",
        tvlUsd: 100_000,
        volume24hUsd: 250_000,
        fee24hUsd: 1_200,
        feeRatePct: 1.2,
        binStep: 80,
        signalScore: 22,
        jupScore: 20,
        smartMoneyScore: 24,
        ilRisk: "HIGH",
        signalSeed: "AVOID",
        currentPrice: 0.01,
        activeBinId: 2,
        mintAuthorityRevoked: false,
        freezeAuthorityRevoked: false,
        liquidityLocked: false,
        topHolderSharePct: 82,
        topTenHolderSharePct: 96,
      },
    ],
    prices: [],
  } as const;

  const enriched = await service.enrichSnapshot(snapshot as never);
  const pool = enriched.pools[0];

  assert.ok(pool);
  assert.ok(typeof pool?.degenScore === "number");
  assert.ok(typeof pool?.whalePressureScore === "number");
  assert.ok(typeof pool?.socialVelocityScore === "number");
  assert.ok(typeof pool?.contractRiskScore === "number");
});
