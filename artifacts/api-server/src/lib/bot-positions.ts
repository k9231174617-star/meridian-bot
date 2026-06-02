import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveStorageDirs } from "./bot-status.js";

export type BotPositionRecord = {
  address: string;
  poolAddress: string;
  poolName: string;
  tokenX: string;
  tokenY: string;
  lowerBinId: number;
  upperBinId: number;
  activeBinId: number;
  inRange: boolean;
  liquidityUsd: number;
  tokenXAmount: number;
  tokenYAmount: number;
  feesEarned: number;
  pnlUsd: number;
  pnlPct: number;
  openedAt: string;
  updatedAt: string;
  isActive?: boolean;
  source?: "paper" | "live";
  mode?: string;
  status?: "open" | "closed";
};

export type BotPositionsResponse = {
  updatedAt: string;
  total: number;
  active: number;
  closed: number;
  totalLiquidityUsd: number;
  totalFeesEarned: number;
  totalPnlUsd: number;
  positions: BotPositionRecord[];
};

type PositionLine = {
  kind: "position";
  position: {
    positionAddress: string;
    poolAddress: string;
    poolName?: string;
    tokenX?: string;
    tokenY?: string;
    minBinId: number;
    maxBinId: number;
    activeBinId?: number;
    liquidityUsd?: number;
    tokenXAmount?: number;
    tokenYAmount?: number;
    feesEarnedUsd?: number;
    pnlUsd?: number;
    pnlPct?: number;
    createdAt: string;
    updatedAt: string;
    openedAt?: string;
    closedAt?: string;
    isActive: boolean;
    mode?: string;
    source?: "paper" | "live";
    status?: "open" | "closed";
  };
};

export async function loadBotPositions(storageDir = resolveStorageDirs()[0], limit = 20): Promise<BotPositionsResponse> {
  const records = await readAllPositionRecords(storageDir);
  const positions = records
    .map((record) => record.position)
    .reduce<PositionLine["position"][]>((acc, position) => {
      const existingIndex = acc.findIndex((entry) => entry.positionAddress === position.positionAddress);
      if (existingIndex >= 0) {
        acc.splice(existingIndex, 1);
      }
      acc.push(position);
      return acc;
    }, [])
    .sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())
    .slice(-Math.max(1, limit))
    .reverse();

  const mapped = positions.map((position) => {
    const activeBinId = position.activeBinId ?? position.minBinId;
    const inRange = activeBinId >= position.minBinId && activeBinId <= position.maxBinId;
    const liquidityUsd = round2(position.liquidityUsd ?? 0);
    const feesEarned = round2(position.feesEarnedUsd ?? 0);
    const pnlUsd = round2(position.pnlUsd ?? 0);
    const pnlPct = round2(position.pnlPct ?? (liquidityUsd > 0 ? (pnlUsd / liquidityUsd) * 100 : 0));
    return {
      address: position.positionAddress,
      poolAddress: position.poolAddress,
      poolName: position.poolName ?? "Unknown Pool",
      tokenX: position.tokenX ?? "TOKEN",
      tokenY: position.tokenY ?? "USDC",
      lowerBinId: position.minBinId,
      upperBinId: position.maxBinId,
      activeBinId,
      inRange,
      liquidityUsd,
      tokenXAmount: round2(position.tokenXAmount ?? liquidityUsd),
      tokenYAmount: round2(position.tokenYAmount ?? 0),
      feesEarned,
      pnlUsd,
      pnlPct,
      openedAt: position.openedAt ?? position.createdAt,
      updatedAt: position.updatedAt,
      isActive: position.isActive,
      source: position.source,
      mode: position.mode,
      status: position.status,
    } satisfies BotPositionRecord;
  });

  const active = mapped.filter((position) => position.isActive !== false).length;
  const closed = mapped.filter((position) => position.isActive === false).length;
  const activeLiquidity = mapped.filter((position) => position.isActive !== false).reduce((sum, position) => sum + position.liquidityUsd, 0);
  const totalFeesEarned = mapped.reduce((sum, position) => sum + position.feesEarned, 0);
  const totalPnlUsd = mapped.reduce((sum, position) => sum + position.pnlUsd, 0);

  return {
    updatedAt: new Date().toISOString(),
    total: mapped.length,
    active,
    closed,
    totalLiquidityUsd: round2(activeLiquidity),
    totalFeesEarned: round2(totalFeesEarned),
    totalPnlUsd: round2(totalPnlUsd),
    positions: mapped,
  };
}

async function readAllPositionRecords(storageDir: string) {
  const dirs = storageDir ? [storageDir, ...resolveStorageDirs().filter((candidate) => candidate !== path.resolve(storageDir))] : resolveStorageDirs();
  const records: PositionLine[] = [];

  for (const dir of dirs) {
    try {
      const raw = await readFile(path.join(dir, "positions.jsonl"), "utf8");
      records.push(
        ...raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .flatMap((line) => {
            try {
              const parsed = JSON.parse(line) as PositionLine;
              return parsed?.kind === "position" && parsed.position ? [parsed] : [];
            } catch {
              return [];
            }
          }),
      );
    } catch {
      continue;
    }
  }

  return records;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
