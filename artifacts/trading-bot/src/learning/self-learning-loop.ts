import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { eventBus, type BotEvent } from "../streams/event-bus.js";
import type { ExecutionResult, MarketSnapshot, PoolSnapshot, Signal, TradeIntent } from "../domain.js";
import {
  ContextualBandit,
  createDefaultLearningBanditState,
  type LearningBanditState,
  type LearningContext,
  type LearningStrategy,
  type LearningStrategyConfig,
} from "./contextual-bandit.js";
import {
  SignalWeightTuner,
  createDefaultSignalWeightState,
  type SignalWeightObservation,
  type SignalWeightState,
  type SignalWeights,
} from "./signal-weight-tuner.js";

export type LearningPlan = {
  strategy: LearningStrategy;
  strategyConfig: LearningStrategyConfig;
  sourceScoped: boolean;
  score: number;
  reasons: string[];
};

type PendingTrade = {
  intentId: string;
  signalId: string;
  poolAddress: string;
  signal: Signal;
  strategy: LearningStrategy;
  strategyConfig: LearningStrategyConfig;
  context: LearningContext;
  openedAt: string;
};

export type SelfLearningState = {
  completedTradeCount: number;
  lastRetrainAt?: string;
  bandit: LearningBanditState;
  tuner: SignalWeightState;
  pending: Record<string, PendingTrade>;
};

export type SelfLearningLoopOptions = {
  storageDir?: string;
  enabled?: boolean;
};

export type LearningTradeClose = {
  intent: TradeIntent;
  execution: ExecutionResult;
  signal: Signal;
  snapshot: MarketSnapshot;
  pool?: PoolSnapshot;
};

export class SelfLearningLoop {
  private readonly bandit: ContextualBandit;
  private readonly tuner: SignalWeightTuner;
  private readonly storageDir: string;
  private readonly statePath: string;
  private readonly experiencePath: string;
  private readonly pendingTrades = new Map<string, PendingTrade>();
  private state: SelfLearningState = {
    completedTradeCount: 0,
    bandit: createDefaultLearningBanditState(),
    tuner: createDefaultSignalWeightState(),
    pending: {},
  };
  private started = false;
  private listeners: Array<() => void> = [];

  constructor(private readonly options: SelfLearningLoopOptions = {}) {
    this.storageDir = path.resolve(options.storageDir ?? process.env.BOT_STORAGE_DIR ?? ".bot-data/trading-bot");
    this.statePath = path.join(this.storageDir, "learning-state.json");
    this.experiencePath = path.join(this.storageDir, "learning-experience.jsonl");
    this.bandit = new ContextualBandit();
    this.tuner = new SignalWeightTuner();
  }

  async start() {
    if (this.started || this.options.enabled === false) return this;
    await this.loadState();
    this.bandit.setState(this.state.bandit);
    this.tuner.setState(this.state.tuner);
    this.bindEventBus();
    this.started = true;
    return this;
  }

  async stop() {
    await this.persistState();
    for (const remove of this.listeners.splice(0)) {
      try {
        remove();
      } catch {
        // ignore
      }
    }
    this.started = false;
  }

  getSignalWeights(): SignalWeights {
    return this.tuner.getWeights();
  }

  selectPlan(params: {
    signal: Signal;
    snapshot: MarketSnapshot;
    previous?: MarketSnapshot;
    history?: MarketSnapshot[];
  }): LearningPlan {
    const context = buildLearningContext(params.signal, params.snapshot);
    const choice = this.bandit.selectStrategy(context);
    return {
      strategy: choice.strategy,
      strategyConfig: choice.config,
      sourceScoped: choice.sourceScoped,
      score: choice.score,
      reasons: buildPlanReasons(params.signal, context, choice.strategy, choice.sourceScoped),
    };
  }

  applyPlan(signal: Signal, plan: LearningPlan): Signal {
    const next = structuredClone(signal) as Signal;
    const config = plan.strategyConfig;
    next.suggestedCapitalUsd = round2(signal.suggestedCapitalUsd * config.positionSizeMultiplier);
    next.slippageBps = Math.max(1, Math.round(signal.slippageBps * (config.tickRangeMultiplier < 1 ? 0.9 : 1.05)));
    next.priorityFeeMicroLamports = Math.max(500, Math.round(signal.priorityFeeMicroLamports * (config.priorityProtection === "MAX" ? 1.2 : 1)));
    next.reason = [...signal.reason, `Learning strategy: ${plan.strategy}`, ...plan.reasons];

    if (next.executionHints?.tickRange) {
      const tickRange = next.executionHints.tickRange;
      const center = tickRange.centerBinId;
      const width = Math.max(1, Math.round((tickRange.upperBinId - tickRange.lowerBinId) * config.tickRangeMultiplier / 2));
      next.executionHints = {
        ...next.executionHints,
        splitCount: clampInt(Math.round((next.executionHints.splitCount ?? 1) * (config.positionSizeMultiplier > 1 ? 1.2 : 0.85)), 1, 20),
        maxDelayMs: Math.max(config.maxDelayMs, next.executionHints.maxDelayMs ?? config.maxDelayMs),
        minDelayMs: Math.max(config.minDelayMs, next.executionHints.minDelayMs ?? 0),
        priorityProtection: config.priorityProtection,
        routeAuction: next.executionHints.routeAuction
          ? { ...next.executionHints.routeAuction, preferredRoute: config.routePreference }
          : { preferredRoute: config.routePreference, candidates: [config.routePreference], simulationBudgetMs: 75 },
        tickRange: {
          ...tickRange,
          lowerBinId: Math.max(0, center - width),
          upperBinId: Math.max(center + 1, center + width),
          confidence: clamp01(tickRange.confidence * (config.tickRangeMultiplier > 1 ? 0.95 : 1.05)),
        },
      };
    } else {
      next.executionHints = {
        ...next.executionHints,
        splitCount: clampInt(Math.round((next.executionHints?.splitCount ?? 1) * (config.positionSizeMultiplier > 1 ? 1.2 : 0.85)), 1, 20),
        minDelayMs: config.minDelayMs,
        maxDelayMs: config.maxDelayMs,
        priorityProtection: config.priorityProtection,
        routeAuction: next.executionHints?.routeAuction
          ? { ...next.executionHints.routeAuction, preferredRoute: config.routePreference }
          : { preferredRoute: config.routePreference, candidates: [config.routePreference], simulationBudgetMs: 75 },
      };
    }

    return next;
  }

  recordPositionOpen(params: { intent: TradeIntent; signal: Signal; snapshot: MarketSnapshot; plan: LearningPlan }) {
    const context = buildLearningContext(params.signal, params.snapshot);
    const pending: PendingTrade = {
      intentId: params.intent.id,
      signalId: params.signal.id,
      poolAddress: params.signal.poolAddress,
      signal: params.signal,
      strategy: params.plan.strategy,
      strategyConfig: params.plan.strategyConfig,
      context,
      openedAt: new Date().toISOString(),
    };
    this.pendingTrades.set(params.intent.id, pending);
    this.state.pending[params.intent.id] = pending;
    void this.appendExperience({
      kind: "open",
      intentId: params.intent.id,
      signalId: params.signal.id,
      strategy: params.plan.strategy,
      context,
      signal: summarizeSignal(params.signal),
      openedAt: pending.openedAt,
    });
    void this.persistState();
  }

  recordPositionClose(params: LearningTradeClose) {
    const pending = this.pendingTrades.get(params.intent.id);
    if (!pending) return;

    const rewardUsd = computeReward(params.execution);
    this.bandit.update(pending.strategy, pending.context, rewardUsd, 0, 0);
    this.tuner.observe(buildWeightObservation(params.signal, params.pool, rewardUsd));
    this.state.completedTradeCount += 1;
    this.state.lastRetrainAt = new Date().toISOString();
    this.pendingTrades.delete(params.intent.id);
    delete this.state.pending[params.intent.id];

    void this.appendExperience({
      kind: "close",
      intentId: params.intent.id,
      signalId: params.signal.id,
      strategy: pending.strategy,
      rewardUsd: round2(rewardUsd),
      pnlUsd: round2(params.execution.filledUsd - params.execution.feesUsd - params.execution.slippageUsd),
      feesUsd: round2(params.execution.feesUsd),
      slippageUsd: round2(params.execution.slippageUsd),
      status: params.execution.status,
      context: pending.context,
      execution: {
        intentId: params.execution.intentId,
        status: params.execution.status,
        txSignature: params.execution.txSignature,
        filledUsd: params.execution.filledUsd,
        feesUsd: params.execution.feesUsd,
        slippageUsd: params.execution.slippageUsd,
      },
      closedAt: new Date().toISOString(),
    });

    if (this.state.completedTradeCount % 50 === 0) {
      void this.persistState();
    }
  }

  getState(): SelfLearningState {
    return {
      completedTradeCount: this.state.completedTradeCount,
      lastRetrainAt: this.state.lastRetrainAt,
      bandit: this.bandit.getState(),
      tuner: this.tuner.getState(),
      pending: { ...this.state.pending },
    };
  }

  private bindEventBus() {
    const openListener = (event: BotEvent) => {
      if (event.data.source !== "trade") return;
      const intent = event.data.intent as TradeIntent | undefined;
      const signal = event.data.signal as Signal | undefined;
      const snapshot = event.data.snapshot as MarketSnapshot | undefined;
      const plan = event.data.plan as LearningPlan | undefined;
      if (!intent || !signal || !snapshot || !plan) return;
      this.recordPositionOpen({ intent, signal, snapshot, plan });
    };

    const closeListener = (event: BotEvent) => {
      if (event.data.source !== "trade") return;
      const intent = event.data.intent as TradeIntent | undefined;
      const signal = event.data.signal as Signal | undefined;
      const snapshot = event.data.snapshot as MarketSnapshot | undefined;
      const execution = event.data.execution as ExecutionResult | undefined;
      if (!intent || !signal || !snapshot || !execution) return;
      const pool = snapshot.pools.find((entry) => entry.address === signal.poolAddress);
      this.recordPositionClose({ intent, execution, signal, snapshot, pool });
    };

    eventBus.on("position:open", openListener);
    eventBus.on("position:close", closeListener);
    this.listeners.push(() => eventBus.off("position:open", openListener));
    this.listeners.push(() => eventBus.off("position:close", closeListener));
  }

  private async loadState() {
    try {
      const raw = await readFile(this.statePath, "utf8");
      const parsed = JSON.parse(raw) as Partial<SelfLearningState>;
      this.state = {
        completedTradeCount: parsed.completedTradeCount ?? 0,
        lastRetrainAt: parsed.lastRetrainAt,
        bandit: parsed.bandit ?? createDefaultLearningBanditState(),
        tuner: parsed.tuner ?? createDefaultSignalWeightState(),
        pending: parsed.pending ?? {},
      };
      this.pendingTrades.clear();
      for (const pending of Object.values(this.state.pending)) {
        this.pendingTrades.set(pending.intentId, pending);
      }
    } catch {
      this.state = {
        completedTradeCount: 0,
        bandit: createDefaultLearningBanditState(),
        tuner: createDefaultSignalWeightState(),
        pending: {},
      };
    }
  }

  private async persistState() {
    await mkdir(this.storageDir, { recursive: true });
    this.state.bandit = this.bandit.getState();
    this.state.tuner = this.tuner.getState();
    await writeFile(this.statePath, `${JSON.stringify(this.state, null, 2)}\n`, "utf8");
  }

  private async appendExperience(record: Record<string, unknown>) {
    await mkdir(this.storageDir, { recursive: true });
    const eventId = stableId(record);
    await appendFile(this.experiencePath, `${JSON.stringify({ ...record, eventId })}\n`, "utf8");
  }
}

function buildLearningContext(signal: Signal, snapshot: MarketSnapshot): LearningContext {
  const pool = snapshot.pools.find((entry) => entry.address === signal.poolAddress);
  const hourOfDay = new Date(snapshot.capturedAt).getUTCHours();
  const marketVolatility = estimateMarketVolatility(snapshot, pool);
  return {
    degenScore: signal.degenScore ?? pool?.degenScore ?? 50,
    holderGini: pool?.holderGini ?? 0.5,
    socialVelocityScore: signal.socialVelocityScore ?? pool?.socialVelocityScore ?? 50,
    tvlUsd: pool?.tvlUsd ?? signal.suggestedCapitalUsd,
    isUnderMevAttack: Boolean(pool?.mevAttackCount && pool.mevAttackCount > 0),
    source: pool?.discoverySource ?? "snapshot",
    hourOfDay,
    marketVolatility,
  };
}

function buildPlanReasons(signal: Signal, context: LearningContext, strategy: LearningStrategy, sourceScoped: boolean) {
  const reasons = [`Bandit strategy ${strategy}`, sourceScoped ? "Source-scoped arm active" : "Global arm active"];
  if (signal.type === "TICK_RANGE_PROPHET" && signal.executionHints?.tickRange) reasons.push(`Forecast tick range center ${signal.executionHints.tickRange.centerBinId}`);
  if (context.isUnderMevAttack) reasons.push("MEV pressure present");
  if (context.socialVelocityScore > 65) reasons.push("Social momentum elevated");
  return reasons;
}

function buildWeightObservation(signal: Signal, pool: PoolSnapshot | undefined, rewardUsd: number): SignalWeightObservation {
  const fdvUsd = pool?.fdvUsd ?? Math.max(pool?.tvlUsd ?? signal.suggestedCapitalUsd, 1) * 8;
  return {
    rewardUsd,
    holderGini: pool?.holderGini ?? 0.5,
    socialVelocityScore: signal.socialVelocityScore ?? pool?.socialVelocityScore ?? 50,
    mintAuthorityRevoked: pool?.mintAuthorityRevoked ?? true,
    devWalletAgeDays: pool?.devWalletAgeDays ?? 7,
    tvlUsd: pool?.tvlUsd ?? signal.suggestedCapitalUsd,
    fdvRatio: fdvUsd > 0 ? fdvUsd / Math.max(1, pool?.tvlUsd ?? signal.suggestedCapitalUsd) : 0,
    previousRugsByDev: pool?.previousRugsByDev ?? 0,
    degenScore: signal.degenScore ?? pool?.degenScore ?? 50,
    whalePressureScore: signal.whalePressureScore ?? pool?.whalePressureScore ?? 50,
  };
}

function summarizeSignal(signal: Signal) {
  return {
    id: signal.id,
    type: signal.type,
    action: signal.action,
    poolAddress: signal.poolAddress,
    confidence: signal.confidence,
    severity: signal.severity,
    reason: signal.reason,
    executionHints: signal.executionHints,
  };
}

function computeReward(execution: ExecutionResult) {
  if (execution.status === "filled" || execution.status === "simulated") {
    return execution.filledUsd - execution.feesUsd - execution.slippageUsd;
  }
  return -Math.max(10, execution.filledUsd * 0.05 + execution.feesUsd + execution.slippageUsd);
}

function estimateMarketVolatility(snapshot: MarketSnapshot, pool?: PoolSnapshot) {
  const poolSignals = snapshot.pools.slice(0, 10);
  const tvlRange = poolSignals.reduce((acc, entry) => acc + Math.abs(entry.tvlUsd - (pool?.tvlUsd ?? entry.tvlUsd)) / Math.max(1, pool?.tvlUsd ?? entry.tvlUsd), 0);
  const volumeRange = poolSignals.reduce((acc, entry) => acc + Math.abs(entry.volume24hUsd - (pool?.volume24hUsd ?? entry.volume24hUsd)) / Math.max(1, pool?.volume24hUsd ?? entry.volume24hUsd), 0);
  return round2(Math.min(100, (tvlRange + volumeRange) * 10));
}

function stableId(input: unknown) {
  return `lrn_${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function clampInt(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
