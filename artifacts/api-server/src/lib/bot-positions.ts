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

type EventHistoryLine = {
  kind: "event_history";
  event: {
    eventType: string;
    poolAddress?: string;
    createdAt: string;
    payload: {
      data?: {
        signal?: Record<string, unknown>;
        intent?: Record<string, unknown>;
        execution?: Record<string, unknown>;
        snapshot?: { pools?: Array<Record<string, unknown>> };
        plan?: Record<string, unknown>;
      };
    };
  };
};

export async function loadBotPositions(storageDir = resolveStorageDirs()[0], limit = 20): Promise<BotPositionsResponse> {
  const positions = await loadPositionRecords(storageDir, limit);
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

async function loadPositionRecords(storageDir: string, limit: number): Promise<PositionLine["position"][]> {
  const fileRecords = await readAllPositionRecords(storageDir);
  const positions = dedupeAndSort(fileRecords.map((record) => record.position), limit);
  if (positions.length > 0) return positions;
  return loadPositionsFromEventHistory(storageDir, limit);
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

async function loadPositionsFromEventHistory(storageDir: string, limit: number): Promise<PositionLine["position"][]> {
  const dirs = storageDir ? [storageDir, ...resolveStorageDirs().filter((candidate) => candidate !== path.resolve(storageDir))] : resolveStorageDirs();
  const positions: PositionLine["position"][] = [];

  for (const dir of dirs) {
    try {
      const raw = await readFile(path.join(dir, "event-history.jsonl"), "utf8");
      positions.push(
        ...raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .flatMap((line) => {
            try {
              const parsed = JSON.parse(line) as EventHistoryLine;
              if (parsed.kind !== "event_history") return [];
              if (parsed.event.eventType !== "position:open" && parsed.event.eventType !== "position:close") return [];

              const event = parsed.event;
              const data = event.payload?.data ?? {};
              const signal = (data.signal && typeof data.signal === "object" ? data.signal : {}) as Record<string, any>;
              const intent = (data.intent && typeof data.intent === "object" ? data.intent : {}) as Record<string, any>;
              const execution = (data.execution && typeof data.execution === "object" ? data.execution : {}) as Record<string, any>;
              const snapshotPools = Array.isArray(data.snapshot?.pools) ? data.snapshot?.pools ?? [] : [];
              const pool = snapshotPools.find((entry: any) => entry?.address === event.poolAddress || entry?.address === signal.poolAddress);
              const positionAddress = String(intent.id ?? signal.id ?? `${event.poolAddress ?? "pool"}`);
              const activeBinId = Number(pool?.activeBinId ?? signal.activeBinId ?? 0);
              const lowerBinId = Number(signal.executionHints?.tickRange?.lowerBinId ?? Math.max(0, activeBinId - 3));
              const upperBinId = Number(signal.executionHints?.tickRange?.upperBinId ?? activeBinId + 3);
              const liquidityUsd = round2(Number(intent.amountUsd ?? execution.filledUsd ?? signal.suggestedCapitalUsd ?? 0));
              const feesEarned = round2(Number(execution.feesUsd ?? 0));
              const pnlUsd = round2(Number(execution.filledUsd ?? 0) - Number(execution.feesUsd ?? 0) - Number(execution.slippageUsd ?? 0));
              const isActive = event.eventType === "position:open";

              return [{
                positionAddress,
                poolAddress: String(event.poolAddress ?? signal.poolAddress ?? ""),
                poolName: String(signal.poolName ?? pool?.name ?? event.poolAddress ?? "Unknown Pool"),
                tokenX: String(pool?.tokenX ?? "TOKEN"),
                tokenY: String(pool?.tokenY ?? "USDC"),
                minBinId: lowerBinId,
                maxBinId: upperBinId,
                activeBinId,
                liquidityUsd,
                tokenXAmount: round2(Number(intent.amountUsd ?? liquidityUsd)),
                tokenYAmount: 0,
                feesEarnedUsd: feesEarned,
                pnlUsd: isActive ? 0 : pnlUsd,
                pnlPct: isActive ? 0 : (liquidityUsd > 0 ? (pnlUsd / liquidityUsd) * 100 : 0),
                createdAt: event.createdAt,
                updatedAt: event.createdAt,
                openedAt: event.eventType === "position:open" ? event.createdAt : String(data.plan?.openedAt ?? event.createdAt),
                closedAt: event.eventType === "position:close" ? event.createdAt : undefined,
                isActive,
                mode: "paper",
                source: "paper",
                status: isActive ? "open" : "closed",
              } satisfies PositionLine["position"]];
            } catch {
              return [];
            }
          }),
      );
    } catch {
      continue;
    }
  }

  return dedupeAndSort(positions, limit);
}

function dedupeAndSort(positions: PositionLine["position"][], limit: number) {
  return positions
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
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
