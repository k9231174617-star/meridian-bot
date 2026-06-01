import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { Alert } from "./alerts.js";
import type { MarketSnapshot, Signal, TradeIntent, ExecutionResult, RiskDecision, StoredPosition, RetryJob } from "./domain.js";
import type { BotConfig } from "./config.js";

export type BotStorage = {
  saveRunStart(config: BotConfig, startedAt: string): Promise<number>;
  saveRunFinish(runId: number, status: "completed" | "failed", summary: Record<string, unknown>, endedAt: string): Promise<void>;
  saveSnapshot(snapshot: MarketSnapshot): Promise<void>;
  loadLastSnapshot(): Promise<MarketSnapshot | null>;
  saveSignal(signal: Signal): Promise<void>;
  loadSignal(signalId: string): Promise<Signal | null>;
  saveRiskDecision(signalId: string, decision: RiskDecision): Promise<void>;
  saveIntent(intent: TradeIntent): Promise<void>;
  loadIntent(signalId: string): Promise<TradeIntent | null>;
  saveExecution(execution: ExecutionResult): Promise<void>;
  loadExecutionByIntentId(intentId: string): Promise<ExecutionResult | null>;
  saveAlert(alert: Alert): Promise<void>;
  savePosition(position: StoredPosition): Promise<void>;
  loadPosition(poolAddress: string): Promise<StoredPosition | null>;
  saveRetryJob(job: RetryJob): Promise<void>;
  loadDueRetryJobs(now?: string): Promise<RetryJob[]>;
  markRetryJobDone(jobId: string): Promise<void>;
  markRetryJobDeadLetter(jobId: string, reason: string): Promise<void>;
};

type JsonLineRecord =
  | { kind: "run_start"; runId: number; startedAt: string; config: BotConfig }
  | { kind: "run_finish"; runId: number; status: "completed" | "failed"; summary: Record<string, unknown>; endedAt: string }
  | { kind: "snapshot"; snapshot: MarketSnapshot }
  | { kind: "signal"; signal: Signal }
  | { kind: "risk"; signalId: string; decision: RiskDecision }
  | { kind: "intent"; intent: TradeIntent }
  | { kind: "execution"; execution: ExecutionResult }
  | { kind: "alert"; alert: Alert }
  | { kind: "position"; position: StoredPosition }
  | { kind: "retry_job"; job: RetryJob; reason?: string };

type FileStorageState = {
  lastRunId: number;
};

export async function createStorage(databaseUrl?: string, options?: { storageDir?: string }): Promise<BotStorage | null> {
  if (databaseUrl) {
    const [{ Pool }, schemaModule] = await Promise.all([
      import("pg"),
      import("../../../lib/db/src/schema/bot.js"),
    ]);
    const schema = schemaModule as any;
    const pool = new Pool({ connectionString: databaseUrl });
    const db = drizzle(pool, { schema });

    return {
      async saveRunStart(config, startedAt) {
        const rows = await db
          .insert(schema.botRunsTable)
          .values({
            mode: config.mode,
            status: "running",
            config: config as unknown as Record<string, unknown>,
            summary: { startedAt },
            startedAt: new Date(startedAt),
          })
          .returning({ id: schema.botRunsTable.id });
        return rows[0]?.id ?? 0;
      },
      async saveRunFinish(runId, status, summary, endedAt) {
        if (!runId) return;
        await db
          .update(schema.botRunsTable)
          .set({
            status,
            summary,
            endedAt: new Date(endedAt),
          })
          .where(eq(schema.botRunsTable.id, runId));
      },
      async saveSnapshot(snapshot) {
        await db.insert(schema.marketSnapshotsTable).values({
          source: "trading-bot",
          payload: snapshot,
          observedAt: new Date(snapshot.capturedAt),
        });
      },
      async loadLastSnapshot() {
        const rows = await db.select().from(schema.marketSnapshotsTable).orderBy(desc(schema.marketSnapshotsTable.observedAt)).limit(1);
        const row = rows[0];
        if (!row) return null;
        return row.payload as MarketSnapshot;
      },
      async saveSignal(signal) {
        await db.insert(schema.botSignalsTable).values({
          signalId: signal.id,
          signalType: signal.type,
          action: signal.action,
          poolAddress: signal.poolAddress,
          poolName: signal.poolName,
          riskLevel: signal.risk,
          confidence: signal.confidence,
          severity: signal.severity,
          reasons: signal.reason,
          payload: signal,
          createdAt: new Date(signal.createdAt),
        }).onConflictDoNothing({ target: schema.botSignalsTable.signalId });
      },
      async loadSignal(signalId) {
        const rows = await db.select().from(schema.botSignalsTable).where(eq(schema.botSignalsTable.signalId, signalId)).limit(1);
        const row = rows[0];
        if (!row) return null;
        return row.payload as Signal;
      },
      async saveRiskDecision(signalId, decision) {
        await db.insert(schema.botRiskEventsTable).values({
          signalId,
          kind: decision.approved ? "approved" : "rejected",
          severity: decision.circuitBreakerActive ? "critical" : "info",
          message: decision.reason,
          payload: decision,
        });
      },
      async saveIntent(intent) {
        await db.insert(schema.botTradeIntentsTable).values({
          signalId: intent.signalId,
          signalType: intent.signalType,
          action: intent.action,
          mode: intent.mode,
          route: intent.route,
          poolAddress: intent.poolAddress,
          amountUsd: intent.amountUsd,
          slippageBps: intent.slippageBps,
          priorityFeeMicroLamports: intent.priorityFeeMicroLamports,
          status: "created",
          payload: intent,
        }).onConflictDoNothing({ target: schema.botTradeIntentsTable.signalId });
      },
      async loadIntent(signalId) {
        const rows = await db.select().from(schema.botTradeIntentsTable).where(eq(schema.botTradeIntentsTable.signalId, signalId)).limit(1);
        const row = rows[0];
        if (!row) return null;
        return row.payload as TradeIntent;
      },
      async saveExecution(execution) {
        await db.insert(schema.botExecutionsTable).values({
          intentId: execution.intentId,
          status: execution.status,
          txSignature: execution.txSignature,
          filledUsd: execution.filledUsd,
          feesUsd: execution.feesUsd,
          slippageUsd: execution.slippageUsd,
          reason: execution.reason,
          payload: execution,
        }).onConflictDoNothing({ target: schema.botExecutionsTable.intentId });
      },
      async loadExecutionByIntentId(intentId) {
        const rows = await db.select().from(schema.botExecutionsTable).where(eq(schema.botExecutionsTable.intentId, intentId)).limit(1);
        const row = rows[0];
        if (!row) return null;
        return row.payload as ExecutionResult;
      },
      async saveAlert(alert) {
        await db.insert(schema.botRiskEventsTable).values({
          signalId: "alert",
          kind: "alert",
          severity: alert.severity,
          message: alert.title,
          payload: alert,
        });
      },
      async savePosition(position) {
        await db
          .insert(schema.botPositionsTable)
          .values({
            poolAddress: position.poolAddress,
            positionAddress: position.positionAddress,
            minBinId: position.minBinId,
            maxBinId: position.maxBinId,
            strategyType: position.strategyType,
            isActive: position.isActive,
            payload: position,
            updatedAt: new Date(position.updatedAt),
            createdAt: new Date(position.createdAt),
          })
          .onConflictDoUpdate({
            target: schema.botPositionsTable.poolAddress,
            set: {
              positionAddress: position.positionAddress,
              minBinId: position.minBinId,
              maxBinId: position.maxBinId,
              strategyType: position.strategyType,
              isActive: position.isActive,
              payload: position,
              updatedAt: new Date(position.updatedAt),
            },
          });
      },
      async loadPosition(poolAddress) {
        const rows = await db.select().from(schema.botPositionsTable).where(eq(schema.botPositionsTable.poolAddress, poolAddress)).limit(1);
        const row = rows[0];
        if (!row) return null;
        return row.payload as StoredPosition;
      },
      async saveRetryJob(job) {
        await db
          .insert(schema.botRetryJobsTable)
          .values({
            retryId: job.id,
            intentId: job.intent.id,
            signalId: job.intent.signalId,
            status: job.status,
            attempts: job.attempts,
            maxAttempts: job.maxAttempts,
            nextAttemptAt: new Date(job.nextAttemptAt),
            lastError: job.lastError,
            payload: job,
            createdAt: new Date(job.createdAt),
            updatedAt: new Date(job.updatedAt),
          })
          .onConflictDoUpdate({
            target: schema.botRetryJobsTable.retryId,
            set: {
              intentId: job.intent.id,
              signalId: job.intent.signalId,
              status: job.status,
              attempts: job.attempts,
              maxAttempts: job.maxAttempts,
              nextAttemptAt: new Date(job.nextAttemptAt),
              lastError: job.lastError,
              payload: job,
              updatedAt: new Date(job.updatedAt),
            },
          });
      },
      async loadDueRetryJobs(now = new Date().toISOString()) {
        const rows = await db
          .select()
          .from(schema.botRetryJobsTable)
          .where(eq(schema.botRetryJobsTable.status, "pending"))
          .orderBy(desc(schema.botRetryJobsTable.nextAttemptAt))
          .limit(100);
        return rows
          .filter((row) => row.nextAttemptAt <= new Date(now))
          .map((row) => row.payload as RetryJob);
      },
      async markRetryJobDone(jobId) {
        await db.update(schema.botRetryJobsTable).set({ status: "done", updatedAt: new Date() }).where(eq(schema.botRetryJobsTable.retryId, jobId));
      },
      async markRetryJobDeadLetter(jobId, reason) {
        await db.update(schema.botRetryJobsTable).set({ status: "dead-letter", lastError: reason, updatedAt: new Date() }).where(eq(schema.botRetryJobsTable.retryId, jobId));
      },
    };
  }

  return new FileBotStorage(resolveStorageDir(options?.storageDir));
}

class FileBotStorage implements BotStorage {
  private queue: Promise<void> = Promise.resolve();
  private state: FileStorageState | null = null;

  constructor(private readonly baseDir: string) {}

  async saveRunStart(config: BotConfig, startedAt: string): Promise<number> {
    return this.enqueue(async () => {
      const runId = await this.nextRunId();
      await this.append("runs.jsonl", {
        kind: "run_start",
        runId,
        startedAt,
        config,
      } satisfies JsonLineRecord);
      return runId;
    });
  }

  async saveRunFinish(runId: number, status: "completed" | "failed", summary: Record<string, unknown>, endedAt: string): Promise<void> {
    if (!runId) return;
    return this.enqueue(async () => {
      await this.append("runs.jsonl", {
        kind: "run_finish",
        runId,
        status,
        summary,
        endedAt,
      } satisfies JsonLineRecord);
    });
  }

  async saveSnapshot(snapshot: MarketSnapshot): Promise<void> {
    return this.enqueue(async () => {
      await this.append("snapshots.jsonl", {
        kind: "snapshot",
        snapshot,
      } satisfies JsonLineRecord);
    });
  }

  async loadLastSnapshot(): Promise<MarketSnapshot | null> {
    return this.enqueue(async () => {
      const record = await this.readLastRecord("snapshots.jsonl");
      if (!record || record.kind !== "snapshot") return null;
      return record.snapshot;
    });
  }

  async saveSignal(signal: Signal): Promise<void> {
    return this.enqueue(async () => {
      await this.append("signals.jsonl", { kind: "signal", signal } satisfies JsonLineRecord);
    });
  }

  async loadSignal(signalId: string): Promise<Signal | null> {
    return this.enqueue(async () => {
      const record = await this.findRecord("signals.jsonl", (entry) => entry.kind === "signal" && entry.signal.id === signalId);
      if (!record || record.kind !== "signal") return null;
      return record.signal;
    });
  }

  async saveRiskDecision(signalId: string, decision: RiskDecision): Promise<void> {
    return this.enqueue(async () => {
      await this.append("risk-events.jsonl", {
        kind: "risk",
        signalId,
        decision,
      } satisfies JsonLineRecord);
    });
  }

  async saveIntent(intent: TradeIntent): Promise<void> {
    return this.enqueue(async () => {
      await this.append("trade-intents.jsonl", { kind: "intent", intent } satisfies JsonLineRecord);
    });
  }

  async loadIntent(signalId: string): Promise<TradeIntent | null> {
    return this.enqueue(async () => {
      const record = await this.findRecord(
        "trade-intents.jsonl",
        (entry) => entry.kind === "intent" && entry.intent.signalId === signalId,
      );
      if (!record || record.kind !== "intent") return null;
      return record.intent;
    });
  }

  async saveExecution(execution: ExecutionResult): Promise<void> {
    return this.enqueue(async () => {
      await this.append("executions.jsonl", { kind: "execution", execution } satisfies JsonLineRecord);
    });
  }

  async loadExecutionByIntentId(intentId: string): Promise<ExecutionResult | null> {
    return this.enqueue(async () => {
      const record = await this.findRecord(
        "executions.jsonl",
        (entry) => entry.kind === "execution" && entry.execution.intentId === intentId,
      );
      if (!record || record.kind !== "execution") return null;
      return record.execution;
    });
  }

  async saveAlert(alert: Alert): Promise<void> {
    return this.enqueue(async () => {
      await this.append("alerts.jsonl", { kind: "alert", alert } satisfies JsonLineRecord);
    });
  }

  async savePosition(position: StoredPosition): Promise<void> {
    return this.enqueue(async () => {
      await this.append("positions.jsonl", { kind: "position", position } satisfies JsonLineRecord);
    });
  }

  async loadPosition(poolAddress: string): Promise<StoredPosition | null> {
    return this.enqueue(async () => {
      const records = await this.readRecords("positions.jsonl");
      for (let index = records.length - 1; index >= 0; index -= 1) {
        const record = records[index];
        if (record.kind === "position" && record.position.poolAddress === poolAddress) {
          return record.position;
        }
      }
      return null;
    });
  }

  async saveRetryJob(job: RetryJob): Promise<void> {
    return this.enqueue(async () => {
      await this.append("retry-jobs.jsonl", { kind: "retry_job", job } satisfies JsonLineRecord);
    });
  }

  async loadDueRetryJobs(now = new Date().toISOString()): Promise<RetryJob[]> {
    return this.enqueue(async () => {
      const records = await this.readRecords("retry-jobs.jsonl");
      const jobs = new Map<string, RetryJob>();
      for (const record of records) {
        if (record.kind !== "retry_job") continue;
        jobs.set(record.job.id, record.job);
      }
      return [...jobs.values()].filter((job) => job.status === "pending" && new Date(job.nextAttemptAt).getTime() <= new Date(now).getTime());
    });
  }

  async markRetryJobDone(jobId: string): Promise<void> {
    return this.enqueue(async () => {
      const existing = await this.findRecord("retry-jobs.jsonl", (entry) => entry.kind === "retry_job" && entry.job.id === jobId);
      if (!existing || existing.kind !== "retry_job") return;
      await this.append("retry-jobs.jsonl", {
        kind: "retry_job",
        job: { ...existing.job, status: "done", updatedAt: new Date().toISOString() },
      } satisfies JsonLineRecord);
    });
  }

  async markRetryJobDeadLetter(jobId: string, reason: string): Promise<void> {
    return this.enqueue(async () => {
      const existing = await this.findRecord("retry-jobs.jsonl", (entry) => entry.kind === "retry_job" && entry.job.id === jobId);
      if (!existing || existing.kind !== "retry_job") return;
      await this.append("retry-jobs.jsonl", {
        kind: "retry_job",
        job: { ...existing.job, status: "dead-letter", lastError: reason, updatedAt: new Date().toISOString() },
        reason,
      } satisfies JsonLineRecord);
    });
  }

  private async enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async ensureReady() {
    await mkdir(this.baseDir, { recursive: true });
    if (this.state) return;

    try {
      const raw = await readFile(this.statePath(), "utf8");
      this.state = JSON.parse(raw) as FileStorageState;
    } catch {
      this.state = { lastRunId: 0 };
    }
  }

  private async nextRunId() {
    await this.ensureReady();
    this.state ??= { lastRunId: 0 };
    this.state.lastRunId += 1;
    await writeFile(this.statePath(), `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
    return this.state.lastRunId;
  }

  private async append(filename: string, record: JsonLineRecord) {
    await this.ensureReady();
    await appendFile(this.resolvePath(filename), `${JSON.stringify(record)}\n`, "utf8");
  }

  private async readLastRecord(filename: string): Promise<JsonLineRecord | null> {
    await this.ensureReady();
    try {
      const raw = await readFile(this.resolvePath(filename), "utf8");
      const records = parseJsonLines(raw);
      return records.at(-1) ?? null;
    } catch {
      return null;
    }
  }

  private async readRecords(filename: string): Promise<JsonLineRecord[]> {
    await this.ensureReady();
    try {
      const raw = await readFile(this.resolvePath(filename), "utf8");
      return parseJsonLines(raw);
    } catch {
      return [];
    }
  }

  private async findRecord(
    filename: string,
    predicate: (record: JsonLineRecord) => boolean,
  ): Promise<JsonLineRecord | null> {
    const records = await this.readRecords(filename);
    for (let index = records.length - 1; index >= 0; index -= 1) {
      const record = records[index];
      if (predicate(record)) return record;
    }
    return null;
  }

  private statePath() {
    return this.resolvePath("state.json");
  }

  private resolvePath(filename: string) {
    return path.join(this.baseDir, filename);
  }
}

function resolveStorageDir(storageDir?: string) {
  const fallback = path.resolve(process.cwd(), ".bot-data", "trading-bot");
  return storageDir?.trim() ? path.resolve(storageDir) : fallback;
}

function parseJsonLines(raw: string): JsonLineRecord[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as JsonLineRecord];
      } catch {
        return [];
      }
    });
}
