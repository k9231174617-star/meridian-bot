import { createHash } from "node:crypto";
import { loadConfig, resolveSignerSecretKey } from "./config.js";
import { createStorage, type BotStorage } from "./storage.js";
import { DirectMarketDataProvider, LocalApiMarketDataProvider } from "./market-data.js";
import { SignalEngine } from "./signals.js";
import { RiskEngine, type RiskState } from "./risk.js";
import { PaperExecutionClient, DryRunExecutionClient, JupiterSwapExecutionClient } from "./execution.js";
import { BotMetrics } from "./observability.js";
import { createAlertSink } from "./alerts.js";
import { TokenSafetyInspector } from "./security.js";
import { PoolWatcher } from "./pool-watcher.js";
import type { BotMode, MarketSnapshot, RetryJob, TradeIntent } from "./domain.js";

export type RunBotOverrides = {
  maxCycles?: number;
  intervalMs?: number;
};

export async function runBot(modeOverride?: BotMode, overrides?: RunBotOverrides) {
  const config = loadConfig();
  if (modeOverride) config.mode = modeOverride;
  if (typeof overrides?.maxCycles === "number") config.maxCycles = overrides.maxCycles;
  if (typeof overrides?.intervalMs === "number") config.intervalMs = overrides.intervalMs;
  if (config.mode === "paper" && config.maxCycles === undefined && typeof config.paperMaxCycles === "number") {
    config.maxCycles = config.paperMaxCycles;
  }

  const provider = config.provider === "local-api"
    ? new LocalApiMarketDataProvider(config.marketDataBaseUrl)
    : new DirectMarketDataProvider(25, 100_000, config.jupiterApiKey);
  const safetyInspector = config.enableAntiScam && config.rpcUrl
    ? new TokenSafetyInspector({
      rpcUrl: config.rpcUrl,
      rugcheckApiUrl: config.rugcheckApiUrl,
      rugcheckApiKey: config.rugcheckApiKey,
      maxTopHolderSharePct: config.risk.maxTopHolderSharePct,
      maxTopTenHolderSharePct: config.risk.maxTopTenHolderSharePct,
      maxRugRiskScore: config.risk.maxRugRiskScore,
    })
    : null;

  const storage = await createStorage(config.databaseUrl, { storageDir: config.storageDir });
  const alertSink = createAlertSink(config.alertWebhookUrl);
  const signals = new SignalEngine();
  const risk = new RiskEngine(config.risk);
  const executor = await buildExecutor(config);
  const metrics = new BotMetrics();
  const poolWatcher = new PoolWatcher({
    enabled: config.enableWssPoolWatcher,
    rpcUrl: config.rpcUrl,
    rpcWsUrl: config.rpcWsUrl,
    logKeywords: config.wssLogKeywords,
  });
  const stopPoolWatcher = await poolWatcher.start(async (event) => {
    metrics.log("wss_pool_candidate", event);
    await emitAlert({
      severity: "info",
      title: "Potential new pool or launch detected",
      message: `WSS keyword match on signature ${event.signature}`,
      context: event,
      createdAt: event.detectedAt,
    });
  });
  let previous = storage ? await storage.loadLastSnapshot() : null;
  let state: RiskState = { openExposureUsd: 0, dailyLossUsd: 0, consecutiveFailures: 0 };
  let cycles = 0;
  const startedAt = new Date().toISOString();
  const runId = storage ? await storage.saveRunStart(config, startedAt) : 0;
  let runStatus: "completed" | "failed" = "completed";
  const seenSignalIds = new Set<string>();
  const retryBackoffMs = config.retryBackoffMs.length > 0 ? config.retryBackoffMs : [1_000, 3_000, 10_000];

  metrics.recordRunStart(startedAt);

  async function emitAlert(alert: Parameters<typeof alertSink.notify>[0]) {
    metrics.recordAlert(alert);
    if (storage) {
      await storage.saveAlert(alert);
    }
    await alertSink.notify(alert);
  }

  try {
    while (true) {
      cycles += 1;
      metrics.recordCycle();

      let snapshot;
      try {
        snapshot = await provider.fetchSnapshot();
        if (safetyInspector) {
          try {
            snapshot = await safetyInspector.enrichSnapshot(snapshot);
          } catch (error) {
            metrics.log("safety_enrich_failed", { cycle: cycles, error: serializeError(error) });
            await emitAlert({
              severity: "warning",
              title: "Token safety enrichment failed",
              message: "The bot could not complete anti-scam enrichment for this snapshot.",
              context: { cycle: cycles, error: serializeError(error), provider: config.provider },
              createdAt: new Date().toISOString(),
            });
          }
        }
        metrics.recordSnapshot(snapshot.capturedAt);
        state = { ...state, consecutiveFailures: 0, lastSnapshotAt: snapshot.capturedAt, lastBreakerReason: undefined };
      } catch (error) {
        state = {
          ...state,
          consecutiveFailures: state.consecutiveFailures + 1,
          circuitBreakerUntil: new Date(Date.now() + config.risk.circuitBreakerCooldownMs).toISOString(),
          lastBreakerReason: "market-data fetch failed",
        };
        metrics.log("snapshot_failed", { cycle: cycles, error: serializeError(error) });
        await emitAlert({
          severity: "warning",
          title: "Market data fetch failed",
          message: "The bot could not refresh market data for this cycle.",
          context: { cycle: cycles, error: serializeError(error), provider: config.provider },
          createdAt: new Date().toISOString(),
        });
        if (state.consecutiveFailures >= config.risk.circuitBreakerFailureLimit) {
          runStatus = "failed";
          await emitAlert({
            severity: "critical",
            title: "Circuit breaker engaged",
            message: "Consecutive market-data failures triggered the circuit breaker.",
            context: { consecutiveFailures: state.consecutiveFailures, cooldownMs: config.risk.circuitBreakerCooldownMs },
            createdAt: new Date().toISOString(),
          });
          break;
        }
        if (config.maxCycles && cycles >= config.maxCycles) break;
        await sleep(config.intervalMs);
        continue;
      }

      if (storage && config.enableRetryQueue && config.mode === "live") {
        await processRetryQueue({
          storage,
          executor,
          metrics,
          alertSink,
          retryBackoffMs,
          cycle: cycles,
        });
      }

      let cycleSignals = signals.generate({ now: snapshot, previous: previous ?? undefined });
      if (config.mode === "paper" && config.paperDebugForceSignal && cycleSignals.length === 0) {
        const forcedSignal = buildPaperDebugSignal(snapshot, cycles, config.provider);
        if (forcedSignal) {
          cycleSignals = [forcedSignal];
          metrics.log("paper_debug_signal", {
            cycle: cycles,
            signalId: forcedSignal.id,
            provider: config.provider,
            source: "forced",
          });
        }
      }
      metrics.recordSignals(cycleSignals);
      metrics.log("cycle", {
        cycle: cycles,
        signals: cycleSignals.length,
        mode: config.mode,
        provider: config.provider,
        debugForceSignal: config.paperDebugForceSignal,
        debugBypassRisk: config.paperDebugBypassRisk,
      });

      if (storage) {
        await storage.saveSnapshot(snapshot);
      }

      let executedThisCycle = 0;
      for (const signal of cycleSignals) {
        if (seenSignalIds.has(signal.id)) {
          metrics.log("signal_skipped", { signalId: signal.id, reason: "duplicate signal in the same run" });
          continue;
        }

        if (storage) {
          const existingSignal = await storage.loadSignal(signal.id);
          if (!existingSignal) {
            await storage.saveSignal(signal);
          }

          const existingIntent = await storage.loadIntent(signal.id);
          if (existingIntent) {
            const existingExecution = await storage.loadExecutionByIntentId(existingIntent.id);
            if (existingExecution && (existingExecution.status === "filled" || existingExecution.status === "simulated")) {
              seenSignalIds.add(signal.id);
              metrics.log("signal_skipped", { signalId: signal.id, reason: "already executed previously" });
              continue;
            }
          }
        }

        const decision = risk.evaluate(signal, state, snapshot, {
          bypassPaperFilters: config.mode === "paper" && config.paperDebugBypassRisk,
        });
        metrics.recordApproval(decision.approved);
        if (!decision.approved) {
          metrics.recordRejection(decision.reason);
        }
        if (storage) await storage.saveRiskDecision(signal.id, decision);
        if (!decision.approved) {
          metrics.log("signal_rejected", { signalId: signal.id, reason: decision.reason, type: signal.type });
          if (decision.circuitBreakerActive) {
            await emitAlert({
              severity: "warning",
              title: "Risk control rejected a signal",
              message: decision.reason,
              context: { signalId: signal.id, poolAddress: signal.poolAddress, type: signal.type },
              createdAt: new Date().toISOString(),
            });
          }
          continue;
        }

        if (executedThisCycle >= config.risk.maxConcurrentIntents) {
          const message = "Max concurrent intents reached for this cycle";
          metrics.log("intents_skipped", { cycle: cycles, signalId: signal.id, reason: message });
          await emitAlert({
            severity: "warning",
            title: "Intent limit reached",
            message,
            context: { cycle: cycles, signalId: signal.id, limit: config.risk.maxConcurrentIntents },
            createdAt: new Date().toISOString(),
          });
          continue;
        }

        const intent = risk.buildIntent(signal, decision, config.mode);
        if (seenSignalIds.has(intent.signalId)) {
          metrics.log("intent_skipped", { signalId: intent.signalId, reason: "duplicate intent in the same run" });
          continue;
        }

        if (storage) await storage.saveIntent(intent);
        try {
          const result = await executor.execute(intent);
          metrics.recordExecution(result);
          if (storage) await storage.saveExecution(result);
          metrics.log("execution", { signalId: signal.id, intentId: intent.id, status: result.status, reason: result.reason });
          if (typeof signal.impermanentLossPct === "number" && signal.action !== "SWAP") {
            metrics.impermanentLossUsd += Math.max(0, result.filledUsd * (signal.impermanentLossPct / 100));
          }

          if (result.status === "rejected" || result.status === "failed") {
            await emitAlert({
              severity: result.status === "failed" ? "critical" : "warning",
              title: "Execution did not complete",
              message: result.reason ?? "Execution returned non-filled status",
              context: { signalId: signal.id, intentId: intent.id, status: result.status },
              createdAt: new Date().toISOString(),
            });
          }

          state = {
            ...state,
            openExposureUsd: Math.max(0, state.openExposureUsd + result.filledUsd - result.feesUsd),
          };
          seenSignalIds.add(signal.id);
          executedThisCycle += 1;
        } catch (error) {
          state = {
            ...state,
            consecutiveFailures: state.consecutiveFailures + 1,
            circuitBreakerUntil: new Date(Date.now() + config.risk.circuitBreakerCooldownMs).toISOString(),
            lastBreakerReason: "execution failure",
          };
          metrics.log("execution_failed", { signalId: signal.id, intentId: intent.id, error: serializeError(error) });
          await emitAlert({
            severity: "critical",
            title: "Execution failed",
            message: "An execution attempt threw an error.",
            context: { signalId: signal.id, intentId: intent.id, error: serializeError(error) },
            createdAt: new Date().toISOString(),
          });

          if (storage && config.enableRetryQueue && config.mode === "live") {
            const retryJob = buildRetryJob(intent, serializeError(error), retryBackoffMs);
            await storage.saveRetryJob(retryJob);
            metrics.log("retry_queued", { jobId: retryJob.id, signalId: signal.id, attempts: retryJob.attempts, nextAttemptAt: retryJob.nextAttemptAt });
          }
        }
      }

      previous = snapshot;

      if (config.maxCycles && cycles >= config.maxCycles) {
        break;
      }

      await sleep(config.intervalMs);
    }
  } catch (error) {
    runStatus = "failed";
    await emitAlert({
      severity: "critical",
      title: "Bot run crashed",
      message: "The trading bot exited because of an unexpected error.",
      context: { error: serializeError(error) },
      createdAt: new Date().toISOString(),
    });
    throw error;
  } finally {
    await stopPoolWatcher();
    const summary = metrics.snapshot();
    metrics.recordRunFinish(runStatus, new Date().toISOString());
    if (storage) {
      await storage.saveRunFinish(runId, runStatus, summary as unknown as Record<string, unknown>, new Date().toISOString());
    }
    console.log(JSON.stringify({ event: "summary", metrics: summary, telemetry: metrics.telemetrySnapshot() }, null, 2));
  }
}

export async function runPaperTrading(overrides?: RunBotOverrides) {
  return runBot("paper", {
    maxCycles: overrides?.maxCycles ?? loadConfig().paperMaxCycles ?? 1,
    intervalMs: overrides?.intervalMs,
  });
}

function buildPaperDebugSignal(snapshot: MarketSnapshot, cycle: number, provider: string) {
  const pool = snapshot.pools[0];
  if (!pool) return null;

  const id = `dbg_${createHash("sha256")
    .update(JSON.stringify({ capturedAt: snapshot.capturedAt, cycle, poolAddress: pool.address, provider }))
    .digest("hex")
    .slice(0, 24)}`;

  return {
    id,
    type: "PRICE_DISLOCATION" as const,
    action: "SWAP" as const,
    poolAddress: pool.address,
    poolName: pool.name,
    risk: pool.ilRisk,
    confidence: 0.99,
    severity: 99,
    reason: [
      "Paper debug forced signal",
      `Provider ${provider}`,
      `Snapshot ${snapshot.capturedAt}`,
      `Pool ${pool.address}`,
    ],
    suggestedCapitalUsd: round2(Math.max(25, Math.min(250, pool.tvlUsd * 0.01))),
    slippageBps: 25,
    priorityFeeMicroLamports: 2_500,
    createdAt: snapshot.capturedAt,
  };
}

async function buildExecutor(config: ReturnType<typeof loadConfig>) {
  if (config.mode === "paper") return new PaperExecutionClient();
  if (config.mode === "dry-run") return new DryRunExecutionClient();
  const signerSecretKey = await resolveSignerSecretKey(config);
  if (!config.rpcUrl || !signerSecretKey) {
    throw new Error("BOT_RPC_URL and BOT_SIGNER_SECRET_KEY or BOT_SIGNER_SECRET_KEY_FILE are required for live mode");
  }
  return new JupiterSwapExecutionClient(config.rpcUrl, signerSecretKey, config.jupiterApiKey, {
    useJito: config.useJito,
    jitoBlockEngineUrl: config.jitoBlockEngineUrl,
    jitoTipLamports: config.jitoTipLamports,
    jitoDontFrontTag: config.jitoDontFrontTag,
    enableHoneypotSimulation: config.enableHoneypotSimulation,
    maxHoneypotLossBps: config.maxHoneypotLossBps,
  });
}

async function processRetryQueue(params: {
  storage: BotStorage;
  executor: Awaited<ReturnType<typeof buildExecutor>>;
  metrics: BotMetrics;
  alertSink: ReturnType<typeof createAlertSink>;
  retryBackoffMs: number[];
  cycle: number;
}) {
  const jobs = await params.storage.loadDueRetryJobs();
  for (const job of jobs) {
    try {
      const result = await params.executor.execute(job.intent);
      params.metrics.recordExecution(result);
      await params.storage.saveExecution(result);
      params.metrics.log("retry_executed", { jobId: job.id, intentId: job.intent.id, status: result.status });
      if (result.status === "filled" || result.status === "simulated") {
        await params.storage.markRetryJobDone(job.id);
        continue;
      }

      const updated = bumpRetryJob(job, result.reason ? { message: result.reason } : { message: "non-filled retry result" }, params.retryBackoffMs);
      if (updated.attempts >= updated.maxAttempts) {
        await params.storage.markRetryJobDeadLetter(job.id, updated.lastError ?? "retry exhausted");
        await params.alertSink.notify({
          severity: "critical",
          title: "Retry dead-lettered",
          message: updated.lastError ?? "Retry queue exhausted",
          context: { jobId: job.id, intentId: job.intent.id, status: result.status, cycle: params.cycle },
          createdAt: new Date().toISOString(),
        });
      } else {
        await params.storage.saveRetryJob(updated);
      }
    } catch (error) {
      const updated = bumpRetryJob(job, serializeError(error), params.retryBackoffMs);
      if (updated.attempts >= updated.maxAttempts) {
        await params.storage.markRetryJobDeadLetter(job.id, updated.lastError ?? "retry exhausted");
        await params.alertSink.notify({
          severity: "critical",
          title: "Retry dead-lettered",
          message: updated.lastError ?? "Retry queue exhausted",
          context: { jobId: job.id, intentId: job.intent.id, attempts: updated.attempts },
          createdAt: new Date().toISOString(),
        });
      } else {
        await params.storage.saveRetryJob(updated);
      }
    }
  }
}

function buildRetryJob(intent: TradeIntent, error: ReturnType<typeof serializeError>, retryBackoffMs: number[]): RetryJob {
  const createdAt = new Date().toISOString();
  return {
    id: `retry_${createHash("sha256").update(JSON.stringify({ intentId: intent.id, createdAt })).digest("hex").slice(0, 24)}`,
    intent,
    attempts: 1,
    maxAttempts: Math.max(1, retryBackoffMs.length + 1),
    nextAttemptAt: new Date(Date.now() + (retryBackoffMs[0] ?? 1_000)).toISOString(),
    lastError: error.message,
    createdAt,
    updatedAt: createdAt,
    status: "pending",
  };
}

function bumpRetryJob(job: RetryJob, error: ReturnType<typeof serializeError>, retryBackoffMs: number[]): RetryJob {
  const attempts = job.attempts + 1;
  const backoffMs = retryBackoffMs[Math.min(attempts - 1, retryBackoffMs.length - 1)] ?? retryBackoffMs.at(-1) ?? 10_000;
  return {
    ...job,
    attempts,
    lastError: error.message,
    nextAttemptAt: new Date(Date.now() + backoffMs).toISOString(),
    updatedAt: new Date().toISOString(),
    status: attempts >= job.maxAttempts ? "dead-letter" : "pending",
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function serializeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }

  return { message: String(error) };
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
