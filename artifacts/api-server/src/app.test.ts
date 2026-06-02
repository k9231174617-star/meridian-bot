import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import app from "./app";

async function withServer<T>(fn: (baseUrl: string) => Promise<T>) {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const address = server.address();

  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Expected an ephemeral port");
  }

  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    return await fn(baseUrl);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("health endpoint returns ok", { concurrency: false }, async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok" });
  });
});

test("pools endpoint filters and normalizes pool data", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/pair/all")) {
      return new Response(
        JSON.stringify([
          {
            address: "pool-1",
            name: "SOL-USDC",
            liquidity: "2500000",
            trade_volume_24h: "4200000",
            fees_24h: "27000",
            bin_step: "4",
            current_price: "165.22",
            active_id: "321",
          },
          {
            address: "pool-2",
            name: "BONK-USDC",
            liquidity: "50000",
            trade_volume_24h: "10000",
            fees_24h: "15",
            bin_step: "40",
            current_price: "0.00002",
            active_id: "111",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  }) as typeof fetch;

  try {
    await withServer(async (baseUrl) => {
      const response = await originalFetch(
        `${baseUrl}/api/pools?limit=1&minTvl=100000&minJupScore=0`,
      );
      assert.equal(response.status, 200);

      const body = (await response.json()) as { pools: Array<{ address: string }>; total: number };
      assert.equal(body.total, 1);
      assert.equal(body.pools[0]?.address, "pool-1");
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("pools endpoint merges discovery candidates when dexes are enabled", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalStorageDir = process.env.BOT_STORAGE_DIR;
  const dir = await mkdtemp(path.join(os.tmpdir(), "bot-pools-discovery-api-"));
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(dir, "discovery-settings.json"),
      JSON.stringify({ enabledDexes: ["raydium"], updatedAt: "2026-06-01T00:00:00.000Z" }, null, 2),
      "utf8",
    ),
    writeFile(
      path.join(dir, "discovery-candidates.jsonl"),
      [
        JSON.stringify({
          kind: "candidate",
          candidate: {
            id: "raydium:def",
            dex: "raydium",
            source: "wss-log",
            signature: "def",
            detectedAt: "2026-06-01T00:00:00.000Z",
            confidence: 0.72,
            keywords: ["raydium"],
            pool: {
              address: "discovery-raydium-def",
              name: "RAYDIUM DISCOVERY def",
              dex: "raydium",
              tokenX: "RAY",
              tokenY: "SOL",
              tvlUsd: 140000,
              volume24hUsd: 10_000,
              fee24hUsd: 180,
              feeRatePct: 0.13,
              binStep: 4,
              signalScore: 68,
              jupScore: 66,
              smartMoneyScore: 62,
              ilRisk: "HIGH",
              signalSeed: "WATCH",
              currentPrice: 0,
              activeBinId: 0,
              tokenSafetyScore: 18,
              rugRiskScore: 82,
              degenScore: 61,
              socialVelocityScore: 77,
              whalePressureScore: 79,
              eventWindowActive: true,
              eventName: "Narrative breakout",
            },
          },
        }),
      ].join("\n"),
      "utf8",
    ),
  ]);

  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/pair/all")) {
      return new Response(JSON.stringify([]), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected fetch request: ${url}`);
  }) as typeof fetch;

  process.env.BOT_STORAGE_DIR = dir;

  try {
    await withServer(async (baseUrl) => {
      const response = await originalFetch(`${baseUrl}/api/pools?limit=5&minTvl=100000&minJupScore=0`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as {
        pools: Array<{ address: string; name: string; rugRiskScore?: number; degenScore?: number; eventWindowActive?: boolean }>;
        total: number;
      };
      assert.equal(body.total, 1);
      assert.equal(body.pools[0]?.address, "discovery-raydium-def");
      assert.equal(body.pools[0]?.rugRiskScore, 82);
      assert.equal(body.pools[0]?.degenScore, 61);
      assert.equal(body.pools[0]?.eventWindowActive, true);
    });
  } finally {
    globalThis.fetch = originalFetch;
    process.env.BOT_STORAGE_DIR = originalStorageDir;
  }
});

test("prices endpoint returns normalized token prices", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/price/v2")) {
      return new Response(
        JSON.stringify({
          data: {
            So11111111111111111111111111111111111111112: { price: "171.42" },
            EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { price: "1.0" },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  }) as typeof fetch;

  try {
    await withServer(async (baseUrl) => {
      const response = await originalFetch(`${baseUrl}/api/prices?tokens=SOL,USDC`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        prices: {
          SOL: { price: number; change24h: number };
          USDC: { price: number; change24h: number };
        };
      };

      assert.equal(body.prices.SOL.price, 171.42);
      assert.equal(body.prices.SOL.change24h, 0);
      assert.equal(body.prices.USDC.price, 1);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("analytics endpoint builds a wallet summary", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("/user/")) {
      return new Response(
        JSON.stringify({
          userPositions: [
            { total_fee_usd_claimed: "12.5" },
            { total_fee_usd_claimed: "8.25" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  }) as typeof fetch;

  try {
    await withServer(async (baseUrl) => {
      const wallet = "J7wVYf7X4a8k3N1m5P8bQ2cT9uR4fL6sH1dG3eK9mQ2";
      const response = await originalFetch(`${baseUrl}/api/analytics?wallet=${wallet}`);
      assert.equal(response.status, 200);

      const body = (await response.json()) as {
        totalTrades: number;
        totalFeesEarned: number;
        totalPnlUsd: number;
        pnlHistory: Array<{ date: string; pnl: number }>;
      };

      assert.equal(body.totalTrades, 2);
      assert.equal(body.totalFeesEarned, 20.75);
      assert.equal(body.totalPnlUsd, 20.75);
      assert.equal(body.pnlHistory.length, 14);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("bot status endpoint reads shared storage", { concurrency: false }, async () => {
  const originalStorageDir = process.env.BOT_STORAGE_DIR;
  const dir = await mkdtemp(path.join(os.tmpdir(), "bot-status-api-"));
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(dir, "runs.jsonl"),
      [
        JSON.stringify({ kind: "run_start", runId: 1, startedAt: "2026-06-01T00:00:00.000Z", config: { mode: "live", provider: "local-api" } }),
        JSON.stringify({ kind: "run_finish", runId: 1, status: "completed", summary: { snapshots: 4, signals: 2, approved: 1, executions: 1 }, endedAt: "2026-06-01T00:01:00.000Z" }),
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      path.join(dir, "alerts.jsonl"),
      `${JSON.stringify({ kind: "alert", alert: { severity: "critical", title: "Alert", message: "Boom", createdAt: "2026-06-01T00:00:02.000Z" } })}\n`,
      "utf8",
    ),
  ]);

  process.env.BOT_STORAGE_DIR = dir;

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/bot/status`);
      assert.equal(response.status, 200);
      const body = (await response.json()) as { lastRun: { status: string; mode: string; provider?: string; summary?: { snapshots?: number; executions?: number } } | null; recentAlerts: Array<{ severity: string }> };
      assert.equal(body.lastRun?.status, "completed");
      assert.equal(body.lastRun?.mode, "live");
      assert.equal(body.lastRun?.provider, "local-api");
      assert.equal(body.lastRun?.summary?.snapshots, 4);
      assert.equal(body.lastRun?.summary?.executions, 1);
      assert.equal(body.recentAlerts[0]?.severity, "critical");
    });
  } finally {
    process.env.BOT_STORAGE_DIR = originalStorageDir;
  }
});

test("paper trade status endpoint is available", { concurrency: false }, async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/bot/paper-trade/status`);
    assert.equal(response.status, 200);

    const body = (await response.json()) as { status: string };
    assert.equal(body.status, "idle");
  });
});

test("discovery endpoint reads and updates enabled dexes", { concurrency: false }, async () => {
  const originalStorageDir = process.env.BOT_STORAGE_DIR;
  const dir = await mkdtemp(path.join(os.tmpdir(), "bot-discovery-api-"));
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(dir, "discovery-settings.json"),
      JSON.stringify({ enabledDexes: ["meteora", "raydium"], updatedAt: "2026-06-01T00:00:00.000Z" }, null, 2),
      "utf8",
    ),
    writeFile(
      path.join(dir, "discovery-candidates.jsonl"),
      [
        JSON.stringify({
          kind: "candidate",
          candidate: {
            id: "raydium:abc",
            dex: "raydium",
            source: "wss-log",
            signature: "abc",
            detectedAt: "2026-06-01T00:00:00.000Z",
            confidence: 0.71,
            keywords: ["raydium"],
            pool: {
              address: "discovery-raydium-abc",
              name: "RAYDIUM DISCOVERY abc",
              dex: "raydium",
              tokenX: "RAY",
              tokenY: "SOL",
              tvlUsd: 25_000,
              volume24hUsd: 0,
              fee24hUsd: 0,
              feeRatePct: 0,
              binStep: 4,
              signalScore: 66,
              jupScore: 64,
              smartMoneyScore: 62,
              ilRisk: "HIGH",
              signalSeed: "WATCH",
              currentPrice: 0,
              activeBinId: 0,
            },
          },
        }),
      ].join("\n"),
      "utf8",
    ),
  ]);

  process.env.BOT_STORAGE_DIR = dir;

  try {
    await withServer(async (baseUrl) => {
      const initial = await fetch(`${baseUrl}/api/bot/discovery`);
      assert.equal(initial.status, 200);
      const initialBody = await initial.json() as {
        settings: { enabledDexes: string[] };
        candidates: Array<{ dex: string }>;
        totals: { candidates: number; raydium: number };
      };
      assert.deepEqual(initialBody.settings.enabledDexes.sort(), ["meteora", "raydium"].sort());
      assert.equal(initialBody.candidates.length, 1);
      assert.equal(initialBody.totals.raydium, 1);

      const update = await fetch(`${baseUrl}/api/bot/discovery`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ enabledDexes: ["meteora", "orca"] }),
      });
      assert.equal(update.status, 200);
      const updateBody = await update.json() as { settings: { enabledDexes: string[] } };
      assert.deepEqual(updateBody.settings.enabledDexes.sort(), ["meteora", "orca"].sort());

      const disableAll = await fetch(`${baseUrl}/api/bot/discovery`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ enabledDexes: [] }),
      });
      assert.equal(disableAll.status, 200);
      const disableAllBody = await disableAll.json() as { settings: { enabledDexes: string[] } };
      assert.deepEqual(disableAllBody.settings.enabledDexes, []);
    });
  } finally {
    process.env.BOT_STORAGE_DIR = originalStorageDir;
  }
});

test("metrics endpoint exposes scrapeable text", { concurrency: false }, async () => {
  const originalStorageDir = process.env.BOT_STORAGE_DIR;
  const dir = await mkdtemp(path.join(os.tmpdir(), "bot-metrics-api-"));
  await mkdir(dir, { recursive: true });
  await Promise.all([
    writeFile(
      path.join(dir, "runs.jsonl"),
      [
        JSON.stringify({ kind: "run_start", runId: 1, startedAt: "2026-06-01T00:00:00.000Z", config: { mode: "paper", provider: "direct" } }),
        JSON.stringify({ kind: "run_finish", runId: 1, status: "completed", summary: { snapshots: 2, signals: 1, approved: 1, fills: 1, executions: 1 }, endedAt: "2026-06-01T00:01:00.000Z" }),
      ].join("\n"),
      "utf8",
    ),
    writeFile(
      path.join(dir, "alerts.jsonl"),
      `${JSON.stringify({ kind: "alert", alert: { severity: "warning", title: "A", message: "B", createdAt: "2026-06-01T00:00:01.000Z" } })}\n`,
      "utf8",
    ),
  ]);

  process.env.BOT_STORAGE_DIR = dir;

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/metrics`);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.match(body, /meridian_bot_runs_started_total 1/);
      assert.match(body, /meridian_bot_alerts_total 1/);
      assert.match(body, /meridian_bot_paper_trade_status\{status="idle"\} 1/);
    });
  } finally {
    process.env.BOT_STORAGE_DIR = originalStorageDir;
  }
});

test("signals endpoint returns recent signals newest-first", { concurrency: false }, async () => {
  const originalStorageDir = process.env.BOT_STORAGE_DIR;
  const dir = await mkdtemp(path.join(os.tmpdir(), "bot-signals-api-"));
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "signals.jsonl"),
    [
      JSON.stringify({
        kind: "signal",
        signal: {
          id: "sig-1",
          type: "RUG_SHIELD",
          action: "REMOVE_LIQUIDITY",
          poolAddress: "pool-1",
          poolName: "POOL 1",
          risk: "HIGH",
          confidence: 0.99,
          severity: 100,
          reason: ["Rug Pull Shield triggered"],
          suggestedCapitalUsd: 250,
          slippageBps: 25,
          priorityFeeMicroLamports: 3000,
          createdAt: "2026-06-01T00:00:00.000Z",
        },
      }),
      JSON.stringify({
        kind: "signal",
        signal: {
          id: "sig-2",
          type: "SOCIAL_VELOCITY",
          action: "ADD_LIQUIDITY",
          poolAddress: "pool-2",
          poolName: "POOL 2",
          risk: "MEDIUM",
          confidence: 0.91,
          severity: 88,
          reason: ["Narrative velocity accelerating"],
          suggestedCapitalUsd: 180,
          slippageBps: 35,
          priorityFeeMicroLamports: 2100,
          createdAt: "2026-06-01T00:01:00.000Z",
        },
      }),
    ].join("\n"),
    "utf8",
  );

  process.env.BOT_STORAGE_DIR = dir;

  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/bot/signals`);
      assert.equal(response.status, 200);
      const body = await response.json() as {
        total: number;
        counts: Record<string, number>;
        signals: Array<{ id: string; type: string; createdAt: string }>;
      };
      assert.equal(body.total, 2);
      assert.equal(body.signals[0]?.id, "sig-2");
      assert.equal(body.signals[1]?.id, "sig-1");
      assert.equal(body.counts.SOCIAL_VELOCITY, 1);
    });
  } finally {
    process.env.BOT_STORAGE_DIR = originalStorageDir;
  }
});


test("bot controls persist auto trading state", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bot-controls-"));
  const originalStorageDir = process.env.BOT_STORAGE_DIR;
  process.env.BOT_STORAGE_DIR = dir;

  try {
    await withServer(async (baseUrl) => {
      const initial = await fetch(`${baseUrl}/api/bot/controls`);
      assert.equal(initial.status, 200);
      const initialBody = await initial.json() as { autoTradingEnabled: boolean; updatedAt: string };
      assert.equal(initialBody.autoTradingEnabled, true);

      const update = await fetch(`${baseUrl}/api/bot/controls`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ autoTradingEnabled: false }),
      });
      assert.equal(update.status, 200);
      const updateBody = await update.json() as { autoTradingEnabled: boolean; updatedAt: string };
      assert.equal(updateBody.autoTradingEnabled, false);

      const reloaded = await fetch(`${baseUrl}/api/bot/controls`);
      assert.equal(reloaded.status, 200);
      const reloadedBody = await reloaded.json() as { autoTradingEnabled: boolean; updatedAt: string };
      assert.equal(reloadedBody.autoTradingEnabled, false);
    });
  } finally {
    process.env.BOT_STORAGE_DIR = originalStorageDir;
  }
});
