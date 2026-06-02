import { createHash } from "node:crypto";
import { Connection } from "@solana/web3.js";
import { loadConfig, resolveSignerSecretKey } from "./config.js";
import { createStorage, type BotStorage } from "./storage.js";
import { DirectMarketDataProvider, LocalApiMarketDataProvider } from "./market-data.js";
import { SignalEngine } from "./signals.js";
import { RiskEngine, type RiskState } from "./risk.js";
import { PaperExecutionClient, DryRunExecutionClient, JupiterSwapExecutionClient } from "./execution.js";
import { BotMetrics } from "./observability.js";
import { createAlertSink } from "./alerts.js";
import { TokenSafetyInspector } from "./security.js";
import { MemeIntelService } from "./meme-intel.js";
import { BotOrchestrator } from "./orchestrator.js";
import {
  appendDiscoveryCandidate,
  appendDiscoveryObservation,
  buildDiscoveryCandidate,
  buildDiscoveryObservation,
  discoverRecentProgramCandidates,
  loadDiscoveryCandidates,
  loadDiscoveryObservations,
  loadDiscoverySettings,
  mergeDiscoveredPools,
} from "./dex-discovery.js";
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
  const signals = new SignalEngine(config.meme);
  const risk = new RiskEngine(config.risk);
  const executor = await buildExecutor(config);
  const metrics = new BotMetrics();
  const memeIntel = new MemeIntelService({
    socialApiUrl: config.meme.socialApiUrl,
    eventApiUrl: config.meme.eventApiUrl,
  });
  const orchestrator = new BotOrchestrator({
    enabled: true,
    enableWssPoolWatcher: config.enableWssPoolWatcher,
    enableGeyser: Boolean(config.yellowstoneEndpoint),
    wss: {
      rpcUrl: config.rpcUrl,
      rpcWsUrl: config.rpcWsUrl,
      logKeywords: config.wssLogKeywords,
      enabledDexes: config.enabledDexes,
    },
    geyser: {
      endpoint: config.yellowstoneEndpoint,
      token: config.yellowstoneToken,
      enabled: Boolean(config.yellowstoneEndpoint),
    },
  });
  const discoveryRpc = config.rpcUrl ? new Connection(config.rpcUrl, config.rpcWsUrl ? { commitment: "confirmed", wsEndpoint: config.rpcWsUrl } : "confirmed") : null;
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

  const stopOrchestration = await orchestrator.start({
    onPoolNew: async (event) => {
      if (event.data.source === "snapshot") {
        metrics.log("snapshot_pool_candidate", {
          type: event.type,
          ts: event.ts,
          poolAddress: event.poolAddress,
          tokenMint: event.tokenMint,
          walletAddress: event.walletAddress,
          data: event.data,
        });
        return;
      }

      const signature = typeof event.data.signature === "string" ? event.data.signature : undefined;
      const detectedAt = typeof event.data.detectedAt === "string" ? event.data.detectedAt : new Date(event.ts).toISOString();
      const keywords = Array.isArray(event.data.keywords)
        ? event.data.keywords.filter((keyword): keyword is string => typeof keyword === "string")
        : [];
      const programIds = Array.isArray(event.data.programIds)
        ? event.data.programIds.filter((programId): programId is string => typeof programId === "string")
        : [];
      const dexes = Array.isArray(event.data.dexes)
        ? event.data.dexes.filter((dex): dex is "meteora" | "raydium" | "orca" => dex === "meteora" || dex === "raydium" || dex === "orca")
        : [];

      metrics.log("wss_pool_candidate", {
        type: event.type,
        ts: event.ts,
        poolAddress: event.poolAddress,
        tokenMint: event.tokenMint,
        walletAddress: event.walletAddress,
        data: { ...event.data, signature, detectedAt, keywords, programIds, dexes },
      });

      if (storage && signature) {
        for (const dex of dexes) {
          const candidate = buildDiscoveryCandidate({
            dex,
            signature,
            detectedAt,
            keywords,
            confidence: 0.72,
            source: programIds.length > 0 ? "wss-program" : "wss-log",
          });
          await appendDiscoveryCandidate(config.storageDir, candidate);
          await appendDiscoveryObservation(config.storageDir, buildDiscoveryObservation({
            dex,
            signature,
            detectedAt,
            keywords,
            source: programIds.length > 0 ? "wss-program" : "wss-log",
            status: "accepted",
            reason: "WSS keyword match and dex inference",
            accounts: programIds,
          }));
        }
      }

      if (signature) {
        await emitAlert({
          severity: "info",
          title: "Potential new pool or launch detected",
          message: `WSS keyword match on signature ${signature}`,
          context: { ...event, data: { ...event.data, signature, detectedAt, keywords, programIds, dexes } },
          createdAt: detectedAt,
        });
      }
    },
    onTokenMigrate: async (event) => {
      metrics.log("token_migrate_event", {
        type: event.type,
        ts: event.ts,
        poolAddress: event.poolAddress,
        tokenMint: event.tokenMint,
        walletAddress: event.walletAddress,
        data: event.data,
      });
    },
    onSniperDetected: async (event) => {
      metrics.log("sniper_detected_event", {
        type: event.type,
        ts: event.ts,
        poolAddress: event.poolAddress,
        tokenMint: event.tokenMint,
        walletAddress: event.walletAddress,
        data: event.data,
      });
    },
    onPhantomAttacked: async (event) => {
      metrics.log("phantom_attack_event", {
        type: event.type,
        ts: event.ts,
        poolAddress: event.poolAddress,
        tokenMint: event.tokenMint,
        walletAddress: event.walletAddress,
        data: event.data,
      });
    },
  });

  try {
    while (true) {
      cycles += 1;
      metrics.recordCycle();
      const discoverySettings = await loadDiscoverySettings(config.storageDir, config.enabledDexes);
      const seenDiscoverySignatures = new Set((await loadDiscoveryCandidates(config.storageDir, 100)).map((candidate) => candidate.signature).filter((signature): signature is string => Boolean(signature)));
      const discoveryObservationCount = (await loadDiscoveryObservations(config.storageDir, 100)).length;

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
        try {
          snapshot = await memeIntel.enrichSnapshot(snapshot);
        } catch (error) {
          metrics.log("meme_intel_failed", { cycle: cycles, error: serializeError(error) });
          await emitAlert({
            severity: "warning",
            title: "Memecoin intel enrichment failed",
            message: "The bot could not complete meme-specific enrichment for this snapshot.",
            context: { cycle: cycles, error: serializeError(error) },
            createdAt: new Date().toISOString(),
          });
        }
        snapshot = {
          ...snapshot,
          pools: mergeDiscoveredPools(
            snapshot.pools.filter((pool) => !pool.dex || discoverySettings.enabledDexes.includes(pool.dex)),
            await loadDiscoveryCandidates(config.storageDir, 50),
            discoverySettings.enabledDexes,
          ),
        };
        if (discoveryRpc) {
          try {
            const discoveryScan = await discoverRecentProgramCandidates(discoveryRpc, discoverySettings.enabledDexes, seenDiscoverySignatures, config.discoveryBackfillLimit);
            for (const candidate of discoveryScan.candidates) {
              await appendDiscoveryCandidate(config.storageDir, candidate);
              metrics.log("recent_dex_candidate", {
                dex: candidate.dex,
                source: candidate.source,
                signature: candidate.signature,
                confidence: candidate.confidence,
              });
            }
            for (const observation of discoveryScan.observations) {
              await appendDiscoveryObservation(config.storageDir, observation);
              metrics.log("discovery_observation", observation);
            }
            if (discoveryScan.candidates.length > 0) {
              snapshot = {
                ...snapshot,
                pools: mergeDiscoveredPools(snapshot.pools, discoveryScan.candidates, discoverySettings.enabledDexes),
              };
            }
          } catch (error) {
            metrics.log("recent_discovery_failed", { cycle: cycles, error: serializeError(error) });
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

      const recentSnapshots = storage ? await storage.loadRecentSnapshots(6) : [];
      orchestrator.ingestSnapshot(snapshot, previous ?? undefined, recentSnapshots);
      let cycleSignals = signals.generate({ now: snapshot, previous: previous ?? undefined, history: recentSnapshots });
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
        enabledDexes: discoverySettings.enabledDexes,
        discoveryObservations: discoveryObservationCount,
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

        const executionPlan = buildExecutionPlan(intent, signal.executionHints, config.risk.maxConcurrentIntents);
        for (const slice of executionPlan) {
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
            break;
          }

          if (storage) await storage.saveIntent(slice);

          const delayMs = randomDelayMs(signal.executionHints?.minDelayMs, signal.executionHints?.maxDelayMs);
          if (delayMs > 0) {
            metrics.log("execution_delay", { signalId: signal.id, intentId: slice.id, delayMs });
            await sleep(delayMs);
          }

          try {
            const result = await executor.execute(slice);
            metrics.recordExecution(result);
            if (storage) await storage.saveExecution(result);
            metrics.log("execution", { signalId: signal.id, intentId: slice.id, status: result.status, reason: result.reason });
            if (typeof signal.impermanentLossPct === "number" && signal.action !== "SWAP") {
              metrics.impermanentLossUsd += Math.max(0, result.filledUsd * (signal.impermanentLossPct / 100));
            }

            if (result.status === "rejected" || result.status === "failed") {
              await emitAlert({
                severity: result.status === "failed" ? "critical" : "warning",
                title: "Execution did not complete",
                message: result.reason ?? "Execution returned non-filled status",
                context: { signalId: signal.id, intentId: slice.id, status: result.status },
                createdAt: new Date().toISOString(),
              });
            }

            state = {
              ...state,
              openExposureUsd: Math.max(0, state.openExposureUsd + result.filledUsd - result.feesUsd),
            };
            executedThisCycle += 1;
          } catch (error) {
            state = {
              ...state,
              consecutiveFailures: state.consecutiveFailures + 1,
              circuitBreakerUntil: new Date(Date.now() + config.risk.circuitBreakerCooldownMs).toISOString(),
              lastBreakerReason: "execution failure",
            };
            metrics.log("execution_failed", { signalId: signal.id, intentId: slice.id, error: serializeError(error) });
            await emitAlert({
              severity: "critical",
              title: "Execution failed",
              message: "An execution attempt threw an error.",
              context: { signalId: signal.id, intentId: slice.id, error: serializeError(error) },
              createdAt: new Date().toISOString(),
            });

            if (storage && config.enableRetryQueue && config.mode === "live") {
              const retryJob = buildRetryJob(slice, serializeError(error), retryBackoffMs);
              await storage.saveRetryJob(retryJob);
              metrics.log("retry_queued", { jobId: retryJob.id, signalId: signal.id, attempts: retryJob.attempts, nextAttemptAt: retryJob.nextAttemptAt });
            }
          }
        }

        seenSignalIds.add(signal.id);
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
    await stopOrchestration();
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

function buildExecutionPlan(
  intent: TradeIntent,
  executionHints?: {
    splitCount?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
  },
  maxSlices = 1,
) {
  const splitCount = clampInt(Math.min(executionHints?.splitCount ?? 1, maxSlices), 1, 20);
  if (splitCount <= 1 || intent.amountUsd <= 0) return [intent];

  const baseAmount = round2(intent.amountUsd / splitCount);
  const amounts = Array.from({ length: splitCount }, (_, index) => {
    if (index === splitCount - 1) {
      return round2(intent.amountUsd - baseAmount * (splitCount - 1));
    }
    return baseAmount;
  });

  return amounts.map((amountUsd, index) => ({
    ...intent,
    id: createDerivedIntentId(intent.id, index),
    amountUsd,
    executionHints: {
      ...intent.executionHints,
      splitCount: 1,
      minDelayMs: executionHints?.minDelayMs,
      maxDelayMs: executionHints?.maxDelayMs,
    },
    createdAt: new Date().toISOString(),
  }));
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

function randomDelayMs(minDelayMs?: number, maxDelayMs?: number) {
  if (typeof minDelayMs !== "number" && typeof maxDelayMs !== "number") return 0;
  const min = Math.max(0, minDelayMs ?? 0);
  const max = Math.max(min, maxDelayMs ?? min);
  if (max <= 0) return 0;
  return Math.round(min + Math.random() * (max - min));
}

function createDerivedIntentId(parentIntentId: string, sliceIndex: number) {
  return `slice_${createHash("sha256").update(`${parentIntentId}:${sliceIndex}`).digest("hex").slice(0, 24)}`;
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
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
