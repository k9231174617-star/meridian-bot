import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { loadBotPositions } from "./bot-positions.js";

test("loadBotPositions returns latest state per position", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "bot-positions-"));
  await writeFile(
    path.join(dir, "positions.jsonl"),
    [
      JSON.stringify({
        kind: "position",
        position: {
          positionAddress: "pos-1",
          poolAddress: "pool-1",
          poolName: "SOL/USDC",
          tokenX: "SOL",
          tokenY: "USDC",
          minBinId: 8,
          maxBinId: 12,
          activeBinId: 10,
          liquidityUsd: 1000,
          tokenXAmount: 2,
          tokenYAmount: 500,
          feesEarnedUsd: 4,
          pnlUsd: 8,
          pnlPct: 0.8,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T00:00:00.000Z",
          openedAt: "2026-06-01T00:00:00.000Z",
          isActive: true,
          mode: "paper",
          source: "paper",
          status: "open",
        },
      }),
      JSON.stringify({
        kind: "position",
        position: {
          positionAddress: "pos-1",
          poolAddress: "pool-1",
          poolName: "SOL/USDC",
          tokenX: "SOL",
          tokenY: "USDC",
          minBinId: 8,
          maxBinId: 12,
          activeBinId: 13,
          liquidityUsd: 1000,
          tokenXAmount: 2,
          tokenYAmount: 500,
          feesEarnedUsd: 7,
          pnlUsd: 15,
          pnlPct: 1.5,
          createdAt: "2026-06-01T00:00:00.000Z",
          updatedAt: "2026-06-01T01:00:00.000Z",
          openedAt: "2026-06-01T00:00:00.000Z",
          closedAt: "2026-06-01T01:00:00.000Z",
          isActive: false,
          mode: "paper",
          source: "paper",
          status: "closed",
        },
      }),
      "",
    ].join("\n"),
    "utf8",
  );

  const result = await loadBotPositions(dir, 20);

  assert.equal(result.total, 1);
  assert.equal(result.active, 0);
  assert.equal(result.closed, 1);
  assert.equal(result.totalPnlUsd, 15);
  assert.equal(result.positions[0]?.status, "closed");
  assert.equal(result.positions[0]?.inRange, false);
});
