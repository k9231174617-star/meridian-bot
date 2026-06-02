import assert from "node:assert/strict";
import test from "node:test";
import type { MarketSnapshot } from "./domain.js";
import { SignalEngine } from "./signals.js";

const snapshot = {
  capturedAt: "2026-05-31T00:00:00.000Z",
  pools: [
    {
      address: "pool-1",
      name: "SOL-USDC",
      tokenX: "SOL",
      tokenY: "USDC",
      tvlUsd: 2_000_000,
      volume24hUsd: 4_000_000,
      fee24hUsd: 20_000,
      feeRatePct: 1,
      binStep: 4,
      signalScore: 84,
      jupScore: 86,
      smartMoneyScore: 74,
      degenScore: 90,
      socialVelocityScore: 40,
      socialVelocityDelta: 0,
      whalePressureScore: 20,
      whaleFlowBps: 100,
      bondingCurveProgressPct: 0,
      eventWindowActive: false,
      previousRugsByDev: 0,
      holderGini: 0.2,
      contractRiskScore: 10,
      ilRisk: "LOW",
      signalSeed: "ENTER",
      currentPrice: 172,
      activeBinId: 12,
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      liquidityLocked: true,
      topHolderSharePct: 15,
      topTenHolderSharePct: 25,
    },
    {
      address: "pool-2",
      name: "MEME-USDC",
      tokenX: "MEME",
      tokenY: "USDC",
      tvlUsd: 50_000,
      volume24hUsd: 1_000,
      fee24hUsd: 5,
      feeRatePct: 0.01,
      binStep: 80,
      signalScore: 22,
      jupScore: 20,
      smartMoneyScore: 24,
      degenScore: 12,
      socialVelocityScore: 10,
      socialVelocityDelta: -18,
      whalePressureScore: 90,
      whaleFlowBps: -500,
      bondingCurveProgressPct: 0,
      eventWindowActive: false,
      previousRugsByDev: 2,
      holderGini: 0.9,
      contractRiskScore: 85,
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
} satisfies MarketSnapshot;

test("signal engine prioritizes healthy pools and exits risky ones", () => {
  const engine = new SignalEngine();
  const result = engine.generate({ now: snapshot as never });
  const types = new Set(result.map((signal) => signal.type));

  assert.ok(result.length >= 3);
  assert.ok(result[0]?.id.startsWith("sig_"));
  assert.equal(result[0]?.poolAddress, "pool-2");
  assert.equal(result[0]?.type, "RUG_SHIELD");
  assert.equal(result[0]?.action, "REMOVE_LIQUIDITY");
  assert.equal(result[1]?.poolAddress, "pool-2");
  assert.ok(types.has("INSURANCE_HEDGE"));
  assert.ok(result.some((signal) => signal.poolAddress === "pool-1"));
  assert.ok(types.has("EXECUTION_AUCTION") || types.has("FEE_COMPOUNDING_FLYWHEEL"));
});

test("signal engine emits the new phase 3-4 intelligence signals", () => {
  const engine = new SignalEngine();
  const previous = {
    capturedAt: "2026-05-31T23:30:00.000Z",
    pools: [
      {
        address: "pool-forecast",
        name: "MOON-USDC",
        tokenX: "MOON",
        tokenY: "USDC",
        tvlUsd: 1_220_000,
        volume24hUsd: 1_200_000,
        fee24hUsd: 11_000,
        feeRatePct: 0.9,
        binStep: 8,
        signalScore: 82,
        jupScore: 79,
        smartMoneyScore: 72,
        degenScore: 81,
        socialVelocityScore: 58,
        socialVelocityDelta: 0,
        whalePressureScore: 24,
        whaleFlowBps: 90,
        bondingCurveProgressPct: 64,
        eventWindowActive: true,
        eventName: "Community surge",
        eventBlocksRemaining: 18,
        previousRugsByDev: 0,
        holderGini: 0.31,
        contractRiskScore: 12,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 1.03,
        activeBinId: 96,
        creatorAddress: "CreatorA11111111111111111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 18,
        topTenHolderSharePct: 28,
        topHolderWallets: ["wallet-a", "wallet-b", "wallet-c", "wallet-d", "wallet-e"],
        mevAttackCount: 2,
        honeypotSimulationBps: 180,
        createdAt: "2026-05-15T00:00:00.000Z",
      },
      {
        address: "pool-related",
        name: "MOONX-USDC",
        tokenX: "MOONX",
        tokenY: "USDC",
        tvlUsd: 430_000,
        volume24hUsd: 520_000,
        fee24hUsd: 3_200,
        feeRatePct: 0.74,
        binStep: 10,
        signalScore: 71,
        jupScore: 67,
        smartMoneyScore: 61,
        degenScore: 74,
        socialVelocityScore: 60,
        socialVelocityDelta: 0,
        whalePressureScore: 25,
        whaleFlowBps: 70,
        bondingCurveProgressPct: 20,
        eventWindowActive: false,
        previousRugsByDev: 0,
        holderGini: 0.29,
        contractRiskScore: 10,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 0.81,
        activeBinId: 54,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 16,
        topTenHolderSharePct: 24,
        createdAt: "2026-05-20T00:00:00.000Z",
      },
      {
        address: "pool-dead",
        name: "DUST-USDC",
        tokenX: "DUST",
        tokenY: "USDC",
        tvlUsd: 2_400,
        volume24hUsd: 8_000,
        fee24hUsd: 150,
        feeRatePct: 6.25,
        binStep: 60,
        signalScore: 58,
        jupScore: 54,
        smartMoneyScore: 49,
        degenScore: 61,
        socialVelocityScore: 33,
        socialVelocityDelta: -2,
        whalePressureScore: 41,
        whaleFlowBps: 42,
        bondingCurveProgressPct: 0,
        eventWindowActive: false,
        previousRugsByDev: 3,
        holderGini: 0.42,
        contractRiskScore: 18,
        ilRisk: "HIGH",
        signalSeed: "WATCH",
        currentPrice: 0.02,
        activeBinId: 12,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 20,
        topTenHolderSharePct: 31,
        createdAt: "2026-05-29T00:00:00.000Z",
      },
    ],
    prices: [],
  } satisfies MarketSnapshot;

  const current = {
    capturedAt: "2026-06-01T00:00:00.000Z",
    pools: [
      {
        address: "pool-forecast",
        name: "MOON-USDC",
        tokenX: "MOON",
        tokenY: "USDC",
        tvlUsd: 850_000,
        volume24hUsd: 2_600_000,
        fee24hUsd: 18_000,
        feeRatePct: 2.12,
        binStep: 8,
        signalScore: 88,
        jupScore: 84,
        smartMoneyScore: 76,
        degenScore: 84,
        socialVelocityScore: 78,
        socialVelocityDelta: 20,
        whalePressureScore: 48,
        whaleFlowBps: 280,
        bondingCurveProgressPct: 84,
        eventWindowActive: true,
        eventName: "Narrative breakout",
        eventBlocksRemaining: 12,
        previousRugsByDev: 0,
        holderGini: 0.34,
        contractRiskScore: 12,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 1.47,
        activeBinId: 104,
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 18,
        topTenHolderSharePct: 28,
        topHolderWallets: ["wallet-a", "wallet-b", "wallet-c", "wallet-d", "wallet-e"],
        mevAttackCount: 2,
        honeypotSimulationBps: 180,
        createdAt: "2026-05-15T00:00:00.000Z",
      },
      {
        address: "pool-related",
        name: "MOONX-USDC",
        tokenX: "MOONX",
        tokenY: "USDC",
        tvlUsd: 490_000,
        volume24hUsd: 620_000,
        fee24hUsd: 4_000,
        feeRatePct: 0.82,
        binStep: 10,
        signalScore: 74,
        jupScore: 69,
        smartMoneyScore: 63,
        degenScore: 76,
        socialVelocityScore: 65,
        socialVelocityDelta: 5,
        whalePressureScore: 27,
        whaleFlowBps: 82,
        bondingCurveProgressPct: 25,
        eventWindowActive: false,
        previousRugsByDev: 0,
        holderGini: 0.3,
        contractRiskScore: 10,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 0.89,
        activeBinId: 59,
        creatorAddress: "CreatorB11111111111111111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 17,
        topTenHolderSharePct: 25,
        topHolderWallets: ["wallet-a", "wallet-b", "wallet-c", "wallet-z", "wallet-y"],
        createdAt: "2026-05-20T00:00:00.000Z",
      },
      {
        address: "pool-dead",
        name: "DUST-USDC",
        tokenX: "DUST",
        tokenY: "USDC",
        tvlUsd: 2_250,
        volume24hUsd: 8_500,
        fee24hUsd: 160,
        feeRatePct: 6.7,
        binStep: 60,
        signalScore: 60,
        jupScore: 55,
        smartMoneyScore: 50,
        degenScore: 63,
        socialVelocityScore: 34,
        socialVelocityDelta: 1,
        whalePressureScore: 39,
        whaleFlowBps: 38,
        bondingCurveProgressPct: 0,
        eventWindowActive: false,
        previousRugsByDev: 3,
        holderGini: 0.44,
        contractRiskScore: 18,
        ilRisk: "HIGH",
        signalSeed: "WATCH",
        currentPrice: 0.022,
        activeBinId: 14,
        creatorAddress: "CreatorC11111111111111111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 20,
        topTenHolderSharePct: 30,
        createdAt: "2026-05-29T00:00:00.000Z",
      },
    ],
    prices: [],
  } satisfies MarketSnapshot;

  const history: MarketSnapshot[] = [
    {
      capturedAt: "2026-05-31T18:00:00.000Z",
      pools: previous.pools.map((pool) =>
        pool.address === "pool-forecast"
          ? {
              ...pool,
              currentPrice: 0.84,
              activeBinId: 84,
              tvlUsd: 1_180_000,
              volume24hUsd: 1_000_000,
              fee24hUsd: 9_200,
            }
          : pool.address === "pool-related"
            ? {
                ...pool,
                currentPrice: 0.79,
                activeBinId: 51,
                tvlUsd: 410_000,
                volume24hUsd: 480_000,
                fee24hUsd: 2_900,
              }
            : {
                ...pool,
                currentPrice: 0.021,
                activeBinId: 11,
                tvlUsd: 2_800,
                volume24hUsd: 7_600,
                fee24hUsd: 140,
              },
      ),
      prices: [],
    },
    {
      capturedAt: "2026-05-31T20:00:00.000Z",
      pools: previous.pools.map((pool) =>
        pool.address === "pool-forecast"
          ? {
              ...pool,
              currentPrice: 0.98,
              activeBinId: 90,
              tvlUsd: 1_160_000,
              volume24hUsd: 1_080_000,
              fee24hUsd: 9_600,
            }
          : pool,
      ),
      prices: [],
    },
    {
      capturedAt: "2026-05-31T22:00:00.000Z",
      pools: previous.pools.map((pool) =>
        pool.address === "pool-forecast"
          ? {
              ...pool,
              currentPrice: 1.16,
              activeBinId: 98,
              tvlUsd: 1_100_000,
              volume24hUsd: 1_180_000,
              fee24hUsd: 10_400,
            }
          : pool,
      ),
      prices: [],
    },
    {
      capturedAt: "2026-05-31T23:30:00.000Z",
      pools: previous.pools.map((pool) =>
        pool.address === "pool-forecast"
          ? {
              ...pool,
              currentPrice: 1.28,
              activeBinId: 101,
              tvlUsd: 1_050_000,
              volume24hUsd: 1_240_000,
              fee24hUsd: 10_900,
            }
          : pool,
      ),
      prices: [],
    },
  ] as const;

  const result = engine.generate({ previous: previous as never, now: current as never, history: [...history, previous as never] });
  const types = new Set(result.map((signal) => signal.type));

  assert.ok(types.has("TICK_RANGE_PROPHET"));
  assert.ok(types.has("WALLET_FINGERPRINT"));
  assert.ok(types.has("FEE_COMPOUNDING_FLYWHEEL"));
  assert.ok(types.has("NARRATIVE_GRAPH"));
  assert.ok(types.has("DEAD_POOL_RESURRECTOR"));
  assert.ok(types.has("EXECUTION_AUCTION"));
  assert.ok(types.has("PHANTOM_LIQUIDITY"));
});

test("signal engine emits the remaining orchestra signals", () => {
  const engine = new SignalEngine();
  const previous = {
    capturedAt: "2026-05-31T22:00:00.000Z",
    pools: [
      {
        address: "pool-shadow-main",
        name: "SHADOW-USDC",
        tokenX: "SHADOW",
        tokenY: "USDC",
        tvlUsd: 620_000,
        volume24hUsd: 1_120_000,
        fee24hUsd: 8_500,
        feeRatePct: 0.92,
        binStep: 10,
        signalScore: 79,
        jupScore: 76,
        smartMoneyScore: 82,
        degenScore: 78,
        socialVelocityScore: 61,
        socialVelocityDelta: 0,
        whalePressureScore: 22,
        whaleFlowBps: 70,
        bondingCurveProgressPct: 12,
        eventWindowActive: false,
        previousRugsByDev: 0,
        holderGini: 0.34,
        contractRiskScore: 12,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 1.02,
        activeBinId: 88,
        creatorAddress: "CreatorShadow111111111111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 18,
        topTenHolderSharePct: 29,
        topHolderWallets: ["smart-a", "smart-b", "smart-c", "smart-d", "smart-e"],
        createdAt: "2026-05-20T00:00:00.000Z",
      },
      {
        address: "pool-shadow-peer",
        name: "SHADX-USDC",
        tokenX: "SHADX",
        tokenY: "USDC",
        tvlUsd: 340_000,
        volume24hUsd: 520_000,
        fee24hUsd: 3_800,
        feeRatePct: 0.72,
        binStep: 10,
        signalScore: 70,
        jupScore: 68,
        smartMoneyScore: 63,
        degenScore: 70,
        socialVelocityScore: 55,
        socialVelocityDelta: 0,
        whalePressureScore: 19,
        whaleFlowBps: 58,
        bondingCurveProgressPct: 8,
        eventWindowActive: false,
        previousRugsByDev: 0,
        holderGini: 0.3,
        contractRiskScore: 10,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 0.98,
        activeBinId: 72,
        creatorAddress: "CreatorShadow222222222111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 17,
        topTenHolderSharePct: 27,
        topHolderWallets: ["smart-a", "smart-b", "smart-c", "smart-d", "smart-e"],
        createdAt: "2026-05-18T00:00:00.000Z",
      },
      {
        address: "pool-rugdna",
        name: "DNA-USDC",
        tokenX: "DNA",
        tokenY: "USDC",
        tvlUsd: 410_000,
        volume24hUsd: 540_000,
        fee24hUsd: 4_200,
        feeRatePct: 0.82,
        binStep: 12,
        signalScore: 62,
        jupScore: 63,
        smartMoneyScore: 49,
        degenScore: 52,
        socialVelocityScore: 35,
        socialVelocityDelta: -1,
        whalePressureScore: 41,
        whaleFlowBps: 120,
        bondingCurveProgressPct: 18,
        eventWindowActive: false,
        previousRugsByDev: 2,
        holderGini: 0.66,
        contractRiskScore: 58,
        ilRisk: "MEDIUM",
        signalSeed: "WATCH",
        currentPrice: 0.72,
        activeBinId: 64,
        creatorAddress: "CreatorDNA111111111111111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 41,
        topTenHolderSharePct: 71,
        topHolderWallets: ["rug-a", "rug-b", "rug-c", "rug-d"],
        createdAt: "2026-05-19T00:00:00.000Z",
      },
      {
        address: "pool-pump",
        name: "PUMP-USDC",
        tokenX: "PUMP",
        tokenY: "USDC",
        tvlUsd: 750_000,
        volume24hUsd: 1_040_000,
        fee24hUsd: 7_600,
        feeRatePct: 0.96,
        binStep: 8,
        signalScore: 74,
        jupScore: 71,
        smartMoneyScore: 66,
        degenScore: 76,
        socialVelocityScore: 66,
        socialVelocityDelta: 4,
        whalePressureScore: 27,
        whaleFlowBps: 96,
        bondingCurveProgressPct: 94,
        eventWindowActive: true,
        eventName: "Pump.fun nearing graduate",
        eventBlocksRemaining: 14,
        previousRugsByDev: 0,
        holderGini: 0.32,
        contractRiskScore: 14,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 1.4,
        activeBinId: 100,
        creatorAddress: "CreatorPump11111111111111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 22,
        topTenHolderSharePct: 35,
        topHolderWallets: ["pump-a", "pump-b", "pump-c", "pump-d", "pump-e"],
        createdAt: "2026-05-21T00:00:00.000Z",
      },
      {
        address: "pool-trap",
        name: "TRAP-USDC",
        tokenX: "TRAP",
        tokenY: "USDC",
        tvlUsd: 280_000,
        volume24hUsd: 560_000,
        fee24hUsd: 4_100,
        feeRatePct: 0.88,
        binStep: 10,
        signalScore: 69,
        jupScore: 66,
        smartMoneyScore: 57,
        degenScore: 55,
        socialVelocityScore: 47,
        socialVelocityDelta: -2,
        whalePressureScore: 29,
        whaleFlowBps: 110,
        bondingCurveProgressPct: 14,
        eventWindowActive: false,
        previousRugsByDev: 1,
        holderGini: 0.58,
        contractRiskScore: 22,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 1.8,
        activeBinId: 74,
        creatorAddress: "CreatorTrap11111111111111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 39,
        topTenHolderSharePct: 68,
        topHolderWallets: ["trap-a", "trap-b", "trap-c", "trap-d"],
        createdAt: "2026-05-22T00:00:00.000Z",
      },
      {
        address: "pool-cross-meteora",
        name: "ARB-USDC",
        tokenX: "ARB",
        tokenY: "USDC",
        dex: "meteora",
        tvlUsd: 510_000,
        volume24hUsd: 990_000,
        fee24hUsd: 5_200,
        feeRatePct: 0.71,
        binStep: 8,
        signalScore: 73,
        jupScore: 70,
        smartMoneyScore: 64,
        degenScore: 69,
        socialVelocityScore: 52,
        socialVelocityDelta: 2,
        whalePressureScore: 24,
        whaleFlowBps: 85,
        bondingCurveProgressPct: 0,
        eventWindowActive: false,
        previousRugsByDev: 0,
        holderGini: 0.28,
        contractRiskScore: 11,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 1.0,
        activeBinId: 120,
        creatorAddress: "CreatorCross11111111111111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 16,
        topTenHolderSharePct: 24,
        topHolderWallets: ["arb-a", "arb-b", "arb-c", "arb-d", "arb-e"],
        createdAt: "2026-05-20T00:00:00.000Z",
      },
      {
        address: "pool-cross-orca",
        name: "ARB-USDC",
        tokenX: "ARB",
        tokenY: "USDC",
        dex: "orca",
        tvlUsd: 460_000,
        volume24hUsd: 940_000,
        fee24hUsd: 4_800,
        feeRatePct: 0.69,
        binStep: 8,
        signalScore: 72,
        jupScore: 68,
        smartMoneyScore: 62,
        degenScore: 68,
        socialVelocityScore: 51,
        socialVelocityDelta: 1,
        whalePressureScore: 23,
        whaleFlowBps: 78,
        bondingCurveProgressPct: 0,
        eventWindowActive: false,
        previousRugsByDev: 0,
        holderGini: 0.27,
        contractRiskScore: 11,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 1.045,
        activeBinId: 121,
        creatorAddress: "CreatorCross22222222211111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 15,
        topTenHolderSharePct: 23,
        topHolderWallets: ["arb-a", "arb-b", "arb-c", "arb-d", "arb-e"],
        createdAt: "2026-05-20T00:00:00.000Z",
      },
    ],
    prices: [],
  } satisfies MarketSnapshot;

  const current = {
    capturedAt: "2026-06-01T00:00:00.000Z",
    pools: previous.pools.map((pool) => {
      switch (pool.address) {
        case "pool-shadow-main":
          return {
            ...pool,
            currentPrice: 1.18,
            activeBinId: 94,
            tvlUsd: 700_000,
            volume24hUsd: 1_540_000,
            fee24hUsd: 12_200,
            socialVelocityScore: 73,
            socialVelocityDelta: 12,
            smartMoneyScore: 88,
            degenScore: 85,
          };
        case "pool-shadow-peer":
          return {
            ...pool,
            currentPrice: 1.01,
            activeBinId: 74,
            tvlUsd: 390_000,
            volume24hUsd: 640_000,
            fee24hUsd: 4_300,
            socialVelocityScore: 58,
            socialVelocityDelta: 5,
            smartMoneyScore: 70,
          };
        case "pool-rugdna":
          return {
            ...pool,
            volume24hUsd: 490_000,
            fee24hUsd: 4_050,
            socialVelocityScore: 31,
            socialVelocityDelta: -4,
            contractRiskScore: 61,
            holderGini: 0.7,
            topHolderSharePct: 44,
            topTenHolderSharePct: 76,
          };
        case "pool-pump":
          return {
            ...pool,
            currentPrice: 1.68,
            activeBinId: 108,
            tvlUsd: 810_000,
            volume24hUsd: 1_250_000,
            fee24hUsd: 9_100,
            socialVelocityScore: 75,
            socialVelocityDelta: 11,
            bondingCurveProgressPct: 97,
            eventWindowActive: true,
            eventBlocksRemaining: 9,
          };
        case "pool-trap":
          return {
            ...pool,
            currentPrice: 1.42,
            activeBinId: 67,
            tvlUsd: 210_000,
            volume24hUsd: 430_000,
            fee24hUsd: 3_700,
            socialVelocityScore: 43,
            socialVelocityDelta: -7,
          };
        case "pool-cross-meteora":
          return {
            ...pool,
            currentPrice: 1.0,
            activeBinId: 122,
            volume24hUsd: 1_080_000,
            fee24hUsd: 5_700,
          };
        case "pool-cross-orca":
          return {
            ...pool,
            currentPrice: 1.055,
            activeBinId: 123,
            volume24hUsd: 1_020_000,
            fee24hUsd: 5_400,
          };
        default:
          return pool;
      }
    }),
    prices: [],
  } satisfies MarketSnapshot;

  const history: MarketSnapshot[] = [
    {
      capturedAt: "2026-05-31T18:00:00.000Z",
      pools: previous.pools.map((pool) => {
        switch (pool.address) {
          case "pool-shadow-main":
            return { ...pool, currentPrice: 0.98, activeBinId: 85, tvlUsd: 600_000, volume24hUsd: 980_000, fee24hUsd: 7_900 };
          case "pool-shadow-peer":
            return { ...pool, currentPrice: 0.94, activeBinId: 69, tvlUsd: 320_000, volume24hUsd: 470_000, fee24hUsd: 3_300 };
          case "pool-pump":
            return { ...pool, currentPrice: 1.28, activeBinId: 101, tvlUsd: 720_000, volume24hUsd: 980_000, fee24hUsd: 7_100, bondingCurveProgressPct: 91 };
          case "pool-trap":
            return { ...pool, currentPrice: 1.98, activeBinId: 77, tvlUsd: 255_000, volume24hUsd: 520_000, fee24hUsd: 3_900 };
          case "pool-cross-meteora":
            return { ...pool, currentPrice: 0.97, activeBinId: 118, tvlUsd: 500_000, volume24hUsd: 920_000, fee24hUsd: 4_900 };
          case "pool-cross-orca":
            return { ...pool, currentPrice: 1.01, activeBinId: 119, tvlUsd: 450_000, volume24hUsd: 900_000, fee24hUsd: 4_500 };
          default:
            return pool;
        }
      }),
      prices: [],
    },
    {
      capturedAt: "2026-05-31T23:00:00.000Z",
      pools: previous.pools.map((pool) => {
        switch (pool.address) {
          case "pool-shadow-main":
            return { ...pool, currentPrice: 1.09, activeBinId: 90, tvlUsd: 650_000, volume24hUsd: 1_320_000, fee24hUsd: 10_200 };
          case "pool-shadow-peer":
            return { ...pool, currentPrice: 0.99, activeBinId: 73, tvlUsd: 350_000, volume24hUsd: 550_000, fee24hUsd: 3_900 };
          case "pool-pump":
            return { ...pool, currentPrice: 1.46, activeBinId: 105, tvlUsd: 780_000, volume24hUsd: 1_120_000, fee24hUsd: 8_300, bondingCurveProgressPct: 95 };
          case "pool-trap":
            return { ...pool, currentPrice: 1.76, activeBinId: 71, tvlUsd: 225_000, volume24hUsd: 470_000, fee24hUsd: 3_650 };
          case "pool-cross-meteora":
            return { ...pool, currentPrice: 0.99, activeBinId: 120, tvlUsd: 505_000, volume24hUsd: 960_000, fee24hUsd: 5_050 };
          case "pool-cross-orca":
            return { ...pool, currentPrice: 1.03, activeBinId: 121, tvlUsd: 452_000, volume24hUsd: 930_000, fee24hUsd: 4_720 };
          default:
            return pool;
        }
      }),
      prices: [],
    },
  ] satisfies MarketSnapshot[];

  const result = engine.generate({ previous: previous as never, now: current as never, history: [...history, previous as never] });
  const types = new Set(result.map((signal) => signal.type));

  assert.ok(types.has("SMART_MONEY_SHADOW"));
  assert.ok(types.has("RUG_DNA_SCANNER"));
  assert.ok(types.has("CROSS_DEX_ARB"));
  assert.ok(types.has("PUMPFUN_GRADUATE_PREDICTOR"));
  assert.ok(types.has("LIQUIDITY_TRAP"));
  assert.ok(types.has("PREDICTIVE_REBALANCE"));
});

test("signal engine applies fee velocity and asymmetric tick ranges", () => {
  const engine = new SignalEngine();
  const history = [
    {
      capturedAt: "2026-06-01T10:00:00.000Z",
      pools: [
        {
          address: "pool-fee",
          name: "PEPE-USDC",
          tokenX: "PEPE",
          tokenY: "USDC",
          tvlUsd: 900_000,
          volume24hUsd: 1_000_000,
          fee24hUsd: 9_500,
          feeRatePct: 1.06,
          binStep: 25,
          signalScore: 78,
          jupScore: 75,
          smartMoneyScore: 68,
          degenScore: 80,
          socialVelocityScore: 64,
          socialVelocityDelta: 0,
          whalePressureScore: 26,
          whaleFlowBps: 95,
          bondingCurveProgressPct: 22,
          eventWindowActive: false,
          previousRugsByDev: 0,
          holderGini: 0.31,
          contractRiskScore: 10,
          ilRisk: "MEDIUM",
          signalSeed: "ENTER",
          currentPrice: 1,
          activeBinId: 100,
          creatorAddress: "CreatorFee1111111111111111111111111111111111",
          mintAuthorityRevoked: true,
          freezeAuthorityRevoked: true,
          liquidityLocked: true,
          topHolderSharePct: 24,
          topTenHolderSharePct: 39,
          topHolderWallets: ["wallet-a", "wallet-b", "wallet-c", "wallet-d", "wallet-e"],
          createdAt: "2026-05-31T00:00:00.000Z",
        },
      ],
      prices: [],
    },
    {
      capturedAt: "2026-06-01T10:50:00.000Z",
      pools: [
        {
          address: "pool-fee",
          name: "PEPE-USDC",
          tokenX: "PEPE",
          tokenY: "USDC",
          tvlUsd: 930_000,
          volume24hUsd: 1_080_000,
          fee24hUsd: 10_100,
          feeRatePct: 1.09,
          binStep: 25,
          signalScore: 81,
          jupScore: 77,
          smartMoneyScore: 70,
          degenScore: 82,
          socialVelocityScore: 67,
          socialVelocityDelta: 3,
          whalePressureScore: 27,
          whaleFlowBps: 110,
          bondingCurveProgressPct: 34,
          eventWindowActive: false,
          previousRugsByDev: 0,
          holderGini: 0.33,
          contractRiskScore: 10,
          ilRisk: "MEDIUM",
          signalSeed: "ENTER",
          currentPrice: 1.08,
          activeBinId: 104,
          creatorAddress: "CreatorFee1111111111111111111111111111111111",
          mintAuthorityRevoked: true,
          freezeAuthorityRevoked: true,
          liquidityLocked: true,
          topHolderSharePct: 25,
          topTenHolderSharePct: 40,
          topHolderWallets: ["wallet-a", "wallet-b", "wallet-c", "wallet-d", "wallet-e"],
          createdAt: "2026-05-31T00:00:00.000Z",
        },
      ],
      prices: [],
    },
  ] satisfies MarketSnapshot[];

  const now = {
    capturedAt: "2026-06-01T11:00:00.000Z",
    pools: [
      {
        address: "pool-fee",
        name: "PEPE-USDC",
        tokenX: "PEPE",
        tokenY: "USDC",
        tvlUsd: 945_000,
        volume24hUsd: 1_180_000,
        fee24hUsd: 10_800,
        feeRatePct: 1.14,
        binStep: 25,
        signalScore: 84,
        jupScore: 80,
        smartMoneyScore: 73,
        degenScore: 85,
        socialVelocityScore: 70,
        socialVelocityDelta: 6,
        whalePressureScore: 28,
        whaleFlowBps: 130,
        bondingCurveProgressPct: 41,
        eventWindowActive: true,
        eventName: "Narrative breakout",
        eventBlocksRemaining: 24,
        previousRugsByDev: 0,
        holderGini: 0.34,
        contractRiskScore: 10,
        ilRisk: "MEDIUM",
        signalSeed: "ENTER",
        currentPrice: 1.15,
        activeBinId: 109,
        creatorAddress: "CreatorFee1111111111111111111111111111111111",
        mintAuthorityRevoked: true,
        freezeAuthorityRevoked: true,
        liquidityLocked: true,
        topHolderSharePct: 26,
        topTenHolderSharePct: 41,
        topHolderWallets: ["wallet-a", "wallet-b", "wallet-c", "wallet-d", "wallet-e"],
        createdAt: "2026-05-31T00:00:00.000Z",
      },
    ],
    prices: [],
  } satisfies MarketSnapshot;

  const result = engine.generate({ now: now as never, history: [...history, now as never] });
  const feeMomentum = result.find((signal) => signal.type === "FEE_MOMENTUM");
  const tickRange = result.find((signal) => signal.type === "TICK_RANGE_PROPHET");

  assert.ok(feeMomentum);
  assert.equal(feeMomentum?.poolAddress, "pool-fee");
  assert.ok((feeMomentum?.executionHints?.maxDelayMs ?? 0) <= 1_000);
  assert.ok(tickRange);
  const tick = tickRange?.executionHints?.tickRange;
  assert.ok(tick);
  assert.equal(tick?.tokenProfile?.category, "memecoin");
  assert.ok((tick?.tokenProfile?.downsideMultiplier ?? 0) > (tick?.tokenProfile?.upsideMultiplier ?? 0));
  assert.ok((tick?.confidence ?? 0) >= 0.2);
});
