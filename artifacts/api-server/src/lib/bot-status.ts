import { readFile } from "node:fs/promises";
import path from "node:path";

type RunRecord =
  | { kind: "run_start"; runId: number; startedAt: string; config: Record<string, unknown> }
  | { kind: "run_finish"; runId: number; status: "completed" | "failed"; summary: Record<string, unknown>; endedAt: string };

type AlertRecord = { kind: "alert"; alert: { severity: "info" | "warning" | "critical"; title: string; message: string; createdAt: string; context?: Record<string, unknown> } };

export type BotStatusResponse = {
  storageDir: string;
  updatedAt: string;
  totals: {
    runsStarted: number;
    runsFinished: number;
    alerts: number;
    alertsBySeverity: {
      info: number;
      warning: number;
      critical: number;
    };
  };
  lastRun: {
    runId: number;
    status: "running" | "completed" | "failed";
    mode?: string;
    provider?: string;
    startedAt?: string;
    endedAt?: string;
    summary?: Record<string, unknown>;
  } | null;
  recentAlerts: Array<{
    severity: "info" | "warning" | "critical";
    title: string;
    message: string;
    createdAt: string;
  }>;
};

export async function loadBotStatus(storageDir = resolveStorageDir()) : Promise<BotStatusResponse> {
  const runs = await readRecords<RunRecord>("runs.jsonl", storageDir);
  const alerts = await readRecords<AlertRecord>("alerts.jsonl", storageDir);
  const starts = runs.filter((record): record is Extract<RunRecord, { kind: "run_start" }> => record.kind === "run_start");
  const finishes = runs.filter((record): record is Extract<RunRecord, { kind: "run_finish" }> => record.kind === "run_finish");
  const lastStart = starts.at(-1);
  const lastFinish = finishes.filter((record) => !lastStart || record.runId === lastStart.runId).at(-1) ?? finishes.at(-1);
  const lastRun = lastStart
    ? {
      runId: lastStart.runId,
      status: (lastFinish?.status ?? "running") as "running" | "completed" | "failed",
      mode: String(lastStart.config.mode ?? ""),
      provider: String(lastStart.config.provider ?? "") || undefined,
      startedAt: lastStart.startedAt,
      endedAt: lastFinish?.endedAt,
      summary: lastFinish?.summary,
      }
    : null;

  return {
    storageDir,
    updatedAt: new Date().toISOString(),
    totals: {
      runsStarted: starts.length,
      runsFinished: finishes.length,
      alerts: alerts.length,
      alertsBySeverity: countAlertSeverities(alerts),
    },
    lastRun,
    recentAlerts: alerts.slice(-5).map((record) => record.alert),
  };
}

export function resolveStorageDir() {
  return path.resolve(process.env.BOT_STORAGE_DIR ?? ".bot-data/trading-bot");
}

async function readRecords<T>(filename: string, storageDir: string): Promise<T[]> {
  try {
    const raw = await readFile(path.join(storageDir, filename), "utf8");
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as T];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

function countAlertSeverities(alerts: AlertRecord[]) {
  return alerts.reduce(
    (acc, record) => {
      acc[record.alert.severity] += 1;
      return acc;
    },
    { info: 0, warning: 0, critical: 0 },
  );
}
