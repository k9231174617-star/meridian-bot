import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveStorageDir } from "./bot-status.js";

export type RecentSignalRecord = {
  id: string;
  type: string;
  action: string;
  poolAddress: string;
  poolName: string;
  risk: string;
  confidence: number;
  severity: number;
  reason: string[];
  suggestedCapitalUsd: number;
  slippageBps: number;
  priorityFeeMicroLamports: number;
  degenScore?: number;
  socialVelocityScore?: number;
  whalePressureScore?: number;
  eventName?: string;
  executionHints?: {
    splitCount?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
    priorityProtection?: "HIGH" | "MAX";
    hedgeTo?: string;
    tickRange?: {
      lowerBinId: number;
      upperBinId: number;
      centerBinId: number;
      horizonMinutes: number;
      confidence: number;
      predictedMoveBps: number;
    };
    relatedPools?: string[];
    compoundingRatio?: number;
    routeAuction?: {
      preferredRoute: "JUPITER" | "DIRECT_POOL" | "JITO";
      candidates: Array<"JUPITER" | "DIRECT_POOL" | "JITO">;
      simulationBudgetMs: number;
    };
    fingerprintRisk?: number;
    phantomLiquidity?: boolean;
  };
  createdAt: string;
};

export type SignalFeedResponse = {
  updatedAt: string;
  total: number;
  counts: Record<string, number>;
  signals: RecentSignalRecord[];
};

type SignalRecord = {
  kind: "signal";
  signal: RecentSignalRecord;
};

export async function loadRecentSignals(storageDir = resolveStorageDir(), limit = 20): Promise<SignalFeedResponse> {
  const records = await readSignalRecords(storageDir);
  const signals = records
    .filter((record): record is SignalRecord => record.kind === "signal")
    .map((record) => record.signal)
    .slice(-Math.max(1, limit))
    .reverse();

  const counts = signals.reduce<Record<string, number>>((acc, signal) => {
    acc[signal.type] = (acc[signal.type] ?? 0) + 1;
    return acc;
  }, {});

  return {
    updatedAt: new Date().toISOString(),
    total: signals.length,
    counts,
    signals,
  };
}

async function readSignalRecords(storageDir: string) {
  try {
    const raw = await readFile(path.join(storageDir, "signals.jsonl"), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as SignalRecord];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}
