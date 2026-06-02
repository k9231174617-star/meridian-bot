import type { MarketSnapshot, PoolSnapshot, StrategyAction, StrategyDirective, StrategyType } from "./domain.js";
import { eventBus, type BotEvent } from "./streams/event-bus.js";
import { GeyserClient, type GeyserClientOptions } from "./streams/geyser-client.js";
import { WssPoolWatcher, type WssPoolWatcherOptions } from "./streams/wss-pool-watcher.js";

export type OrchestratorHook = (event: BotEvent) => void | Promise<void>;

export type OrchestratorHooks = {
  onAnyEvent?: OrchestratorHook;
  onPoolNew?: OrchestratorHook;
  onPoolTvlDrop?: OrchestratorHook;
  onPoolVolumeSpike?: OrchestratorHook;
  onWalletDevSwap?: OrchestratorHook;
  onWalletWhaleMove?: OrchestratorHook;
  onTokenMintActive?: OrchestratorHook;
  onTokenRugSignal?: OrchestratorHook;
  onTokenMigrate?: OrchestratorHook;
  onSniperDetected?: OrchestratorHook;
  onPositionOpen?: OrchestratorHook;
  onPositionClose?: OrchestratorHook;
  onFeeAccumulated?: OrchestratorHook;
  onSocialVelocitySpike?: OrchestratorHook;
  onPhantomAttacked?: OrchestratorHook;
  onStrategyTriggered?: OrchestratorHook;
};

export type OrchestratorOptions = {
  enabled?: boolean;
  enableWssPoolWatcher?: boolean;
  enableGeyser?: boolean;
  wss?: WssPoolWatcherOptions;
  geyser?: GeyserClientOptions;
};

type OrchestrationStats = {
  eventsEmitted: number;
  eventsByType: Partial<Record<BotEvent["type"], number>>;
  startedAt?: string;
  lastEventAt?: string;
};

type QueuedEvent = {
  event: BotEvent;
  publish: boolean;
};

export class BotOrchestrator {
  private readonly wssWatcher: WssPoolWatcher;
  private readonly geyserClient: GeyserClient;
  private readonly hookHandlers = new Map<BotEvent["type"], OrchestratorHook[]>();
  private readonly eventQueue: QueuedEvent[] = [];
  private readonly recentEvents = new Map<string, number>();
  private readonly busListeners: Array<() => void> = [];
  private hooks: OrchestratorHooks = {};
  private stats: OrchestrationStats = {
    eventsEmitted: 0,
    eventsByType: {},
  };
  private started = false;
  private processingQueue = false;
  private circuitOpenUntil = 0;
  private stopWss?: () => Promise<void>;
  private stopGeyser?: () => Promise<void>;
  private readonly maxQueueSize = 1_000;
  private readonly dedupTtlMs = 30_000;

  constructor(private readonly options: OrchestratorOptions = {}) {
    this.wssWatcher = new WssPoolWatcher({
      ...(options.wss ?? {}),
      enabled: options.enableWssPoolWatcher ?? options.wss?.enabled ?? false,
    });
    this.geyserClient = new GeyserClient({
      ...(options.geyser ?? {}),
      enabled: options.enableGeyser ?? options.geyser?.enabled ?? false,
    });
  }

  async start(hooks: OrchestratorHooks = {}) {
    if (this.started) return async () => this.stop();
    if (this.options.enabled === false) return async () => undefined;

    this.started = true;
    this.stats.startedAt = new Date().toISOString();
    this.hooks = hooks;
    this.bindHooks(hooks);
    this.bindEventBus();

    if (this.options.enableWssPoolWatcher ?? this.options.wss?.enabled) {
      this.stopWss = await this.wssWatcher.start();
    }

    if (this.options.enableGeyser ?? this.options.geyser?.enabled) {
      this.stopGeyser = await this.geyserClient.start();
    }

    return async () => {
      await this.stop();
    };
  }

  async stop() {
    await this.stopWss?.();
    await this.stopGeyser?.();
    this.stopWss = undefined;
    this.stopGeyser = undefined;
    this.eventQueue.length = 0;
    this.hookHandlers.clear();
    this.recentEvents.clear();
    this.hooks = {};
    while (this.busListeners.length > 0) {
      const remove = this.busListeners.pop();
      try {
        remove?.();
      } catch {
        // ignore listener shutdown errors
      }
    }
    this.started = false;
  }

  ingestSnapshot(now: MarketSnapshot, previous?: MarketSnapshot, history: MarketSnapshot[] = []) {
    const prevByAddress = new Map(previous?.pools.map((pool) => [pool.address, pool]));
    const historyByAddress = new Map<string, PoolSnapshot[]>();
    for (const snapshot of history) {
      for (const pool of snapshot.pools) {
        const bucket = historyByAddress.get(pool.address) ?? [];
        bucket.push(pool);
        historyByAddress.set(pool.address, bucket);
      }
    }

    for (const pool of now.pools) {
      const prev = prevByAddress.get(pool.address);
      if (!prev) {
        this.emit({
          type: "pool:new",
          ts: Date.now(),
          poolAddress: pool.address,
          data: {
            source: "snapshot",
            pool,
            capturedAt: now.capturedAt,
          },
        });
      }

      if (typeof prev?.tvlUsd === "number" && prev.tvlUsd > 0) {
        const tvlDropBps = ((prev.tvlUsd - pool.tvlUsd) / prev.tvlUsd) * 10_000;
        if (tvlDropBps >= 1_500) {
          this.emit({
            type: "pool:tvl_drop",
            ts: Date.now(),
            poolAddress: pool.address,
            data: {
              source: "snapshot",
              capturedAt: now.capturedAt,
              previousTvlUsd: round2(prev.tvlUsd),
              currentTvlUsd: round2(pool.tvlUsd),
              tvlDropBps: round2(tvlDropBps),
            },
          });
        }
      }

      if (typeof prev?.volume24hUsd === "number") {
        const volumeDelta = pool.volume24hUsd - prev.volume24hUsd;
        const volumeDeltaBps = prev.volume24hUsd > 0 ? (volumeDelta / prev.volume24hUsd) * 10_000 : 0;
        if (volumeDelta > 0 && (volumeDeltaBps >= 2_500 || volumeDelta >= Math.max(2_500, prev.volume24hUsd * 0.15))) {
          this.emit({
            type: "pool:volume_spike",
            ts: Date.now(),
            poolAddress: pool.address,
            data: {
              source: "snapshot",
              capturedAt: now.capturedAt,
              previousVolume24hUsd: round2(prev.volume24hUsd),
              currentVolume24hUsd: round2(pool.volume24hUsd),
              volumeDeltaUsd: round2(volumeDelta),
              volumeDeltaBps: round2(volumeDeltaBps),
            },
          });
        }
      }

      if (typeof prev?.fee24hUsd === "number") {
        const feeDelta = pool.fee24hUsd - prev.fee24hUsd;
        if (feeDelta > 0 && feeDelta >= Math.max(25, prev.fee24hUsd * 0.1)) {
          this.emit({
            type: "fee:accumulated",
            ts: Date.now(),
            poolAddress: pool.address,
            data: {
              source: "snapshot",
              capturedAt: now.capturedAt,
              previousFee24hUsd: round2(prev.fee24hUsd),
              currentFee24hUsd: round2(pool.fee24hUsd),
              feeDeltaUsd: round2(feeDelta),
            },
          });
        }
      }

      const socialDelta = (pool.socialVelocityScore ?? 0) - (prev?.socialVelocityScore ?? 0);
      if (Math.abs(socialDelta) >= 8) {
        this.emit({
          type: "social:velocity_spike",
          ts: Date.now(),
          poolAddress: pool.address,
          tokenMint: pool.tokenXMint ?? pool.tokenYMint,
          data: {
            source: "snapshot",
            capturedAt: now.capturedAt,
            currentSocialVelocityScore: round2(pool.socialVelocityScore ?? 0),
            previousSocialVelocityScore: round2(prev?.socialVelocityScore ?? 0),
            socialVelocityDelta: round2(socialDelta),
          },
        });
      }

      const whalePressureDelta = (pool.whalePressureScore ?? 0) - (prev?.whalePressureScore ?? 0);
      if ((pool.whalePressureScore ?? 0) >= 70 || whalePressureDelta >= 10) {
        this.emit({
          type: "wallet:whale_move",
          ts: Date.now(),
          poolAddress: pool.address,
          data: {
            source: "snapshot",
            capturedAt: now.capturedAt,
            currentWhalePressureScore: round2(pool.whalePressureScore ?? 0),
            previousWhalePressureScore: round2(prev?.whalePressureScore ?? 0),
            whalePressureDelta: round2(whalePressureDelta),
          },
        });
      }

      if ((pool.rugRiskScore ?? 0) >= 70 || (pool.previousRugsByDev ?? 0) >= 2) {
        this.emit({
          type: "token:rug_signal",
          ts: Date.now(),
          poolAddress: pool.address,
          tokenMint: pool.tokenXMint ?? pool.tokenYMint,
          data: {
            source: "snapshot",
            capturedAt: now.capturedAt,
            rugRiskScore: round2(pool.rugRiskScore ?? 0),
            previousRugsByDev: pool.previousRugsByDev ?? 0,
          },
        });
      }

      if (pool.eventWindowActive || (pool.bondingCurveProgressPct ?? 0) >= 95 || pool.migrateTarget) {
        this.emit({
          type: "token:migrate",
          ts: Date.now(),
          poolAddress: pool.address,
          tokenMint: pool.tokenXMint ?? pool.tokenYMint,
          data: {
            source: "snapshot",
            capturedAt: now.capturedAt,
            bondingCurveProgressPct: round2(pool.bondingCurveProgressPct ?? 0),
            migrateTarget: pool.migrateTarget,
            eventWindowActive: Boolean(pool.eventWindowActive),
          },
        });
      }

      const attacks = (pool.mevAttackCount ?? 0) - (prev?.mevAttackCount ?? 0);
      if ((pool.mevAttackCount ?? 0) > 0 || attacks > 0) {
        this.emit({
          type: "phantom:attacked",
          ts: Date.now(),
          poolAddress: pool.address,
          data: {
            source: "snapshot",
            capturedAt: now.capturedAt,
            currentMevAttackCount: pool.mevAttackCount ?? 0,
            previousMevAttackCount: prev?.mevAttackCount ?? 0,
            attackDelta: attacks,
          },
        });
      }

      const creatorChanged = Boolean(pool.creatorAddress) && (!prev?.creatorAddress || prev.creatorAddress !== pool.creatorAddress);
      if (creatorChanged) {
        this.emit({
          type: "wallet:dev_swap",
          ts: Date.now(),
          poolAddress: pool.address,
          walletAddress: pool.creatorAddress,
          data: {
            source: "snapshot",
            capturedAt: now.capturedAt,
            creatorAddress: pool.creatorAddress,
            previousCreatorAddress: prev?.creatorAddress,
            priorHistoryCount: historyByAddress.get(pool.address)?.length ?? 0,
          },
        });
      }

      if ((pool.topHolderWallets?.length ?? 0) > 0 && prev) {
        const overlap = computeOverlap(pool.topHolderWallets ?? [], prev?.topHolderWallets ?? []);
        if (overlap >= 2) {
          this.emit({
            type: "sniper:detected",
            ts: Date.now(),
            poolAddress: pool.address,
            data: {
              source: "snapshot",
              capturedAt: now.capturedAt,
              topHolderOverlap: overlap,
            },
          });
        }
      }
    }
  }

  snapshot() {
    return { ...this.stats };
  }

  private bindHooks(hooks: OrchestratorHooks) {
    const mappings: Array<[keyof OrchestratorHooks, BotEvent["type"]]> = [
      ["onPoolNew", "pool:new"],
      ["onPoolTvlDrop", "pool:tvl_drop"],
      ["onPoolVolumeSpike", "pool:volume_spike"],
      ["onWalletDevSwap", "wallet:dev_swap"],
      ["onWalletWhaleMove", "wallet:whale_move"],
      ["onTokenMintActive", "token:mint_active"],
      ["onTokenRugSignal", "token:rug_signal"],
      ["onTokenMigrate", "token:migrate"],
      ["onSniperDetected", "sniper:detected"],
      ["onPositionOpen", "position:open"],
      ["onPositionClose", "position:close"],
      ["onFeeAccumulated", "fee:accumulated"],
      ["onSocialVelocitySpike", "social:velocity_spike"],
      ["onPhantomAttacked", "phantom:attacked"],
      ["onStrategyTriggered", "strategy:triggered"],
    ];

    for (const [hookName, eventType] of mappings) {
      const listener = hooks[hookName];
      if (!listener) continue;
      const handlers = this.hookHandlers.get(eventType) ?? [];
      handlers.push(listener);
      this.hookHandlers.set(eventType, handlers);
    }
  }

  private bindEventBus() {
    const eventTypes: BotEvent["type"][] = [
      "pool:new",
      "pool:tvl_drop",
      "pool:volume_spike",
      "wallet:dev_swap",
      "wallet:whale_move",
      "token:mint_active",
      "token:rug_signal",
      "token:migrate",
      "sniper:detected",
      "position:open",
      "position:close",
      "fee:accumulated",
      "social:velocity_spike",
      "phantom:attacked",
    ];

    for (const eventType of eventTypes) {
      const listener = (event: BotEvent) => {
        if (!isStreamEvent(event)) return;
        this.enqueue(event, false);
      };
      eventBus.on(eventType, listener);
      this.busListeners.push(() => eventBus.off(eventType, listener));
    }
  }

  private emit(event: BotEvent) {
    this.enqueue(event, true);
  }

  private enqueue(event: BotEvent, publish: boolean) {
    this.pruneRecentEvents();
    const key = this.eventKey(event);
    const now = Date.now();
    const previous = this.recentEvents.get(key);
    if (typeof previous === "number" && now - previous < this.dedupTtlMs) {
      return;
    }
    this.recentEvents.set(key, now);

    if (now < this.circuitOpenUntil) {
      this.stats.eventsByType[event.type] = (this.stats.eventsByType[event.type] ?? 0) + 1;
      return;
    }

    if (this.eventQueue.length >= this.maxQueueSize) {
      this.circuitOpenUntil = now + 5_000;
      this.stats.eventsByType[event.type] = (this.stats.eventsByType[event.type] ?? 0) + 1;
      console.warn(`[orchestrator] event queue full, dropping ${event.type}`);
      return;
    }

    this.eventQueue.push({ event, publish });
    this.stats.eventsEmitted += 1;
    this.stats.eventsByType[event.type] = (this.stats.eventsByType[event.type] ?? 0) + 1;
    this.stats.lastEventAt = new Date(event.ts).toISOString();
    void this.processQueue();
  }

  private async processQueue() {
    if (this.processingQueue) return;
    this.processingQueue = true;
    try {
      while (this.eventQueue.length > 0) {
        const queued = this.eventQueue.shift();
        if (!queued) continue;
        const { event, publish } = queued;
        if (publish) {
          eventBus.emit(event.type, event);
        }
        if (this.hooks.onAnyEvent) {
          try {
            await Promise.resolve(this.hooks.onAnyEvent(event));
          } catch (error) {
            console.warn(`[orchestrator] onAnyEvent listener failed`, error);
          }
        }
        const directives = this.routeStrategies(event);
        for (const directive of directives) {
          this.enqueue(
            {
              type: "strategy:triggered",
              ts: Date.now(),
              poolAddress: directive.poolAddress,
              tokenMint: directive.tokenMint,
              walletAddress: directive.walletAddress,
              data: {
                source: "orchestrator",
                sourceEventType: directive.sourceEventType,
                strategy: directive.strategy,
                action: directive.action,
                confidence: directive.confidence,
                reasons: directive.reasons,
                executionHints: directive.executionHints ?? null,
              },
            },
            true,
          );
        }
        const handlers = this.hookHandlers.get(event.type);
        if (handlers && handlers.length > 0) {
          for (const handler of handlers) {
            try {
              await Promise.resolve(handler(event));
            } catch (error) {
              console.warn(`[orchestrator] ${event.type} listener failed`, error);
            }
          }
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  private pruneRecentEvents() {
    const cutoff = Date.now() - this.dedupTtlMs;
    for (const [key, ts] of this.recentEvents) {
      if (ts < cutoff) this.recentEvents.delete(key);
    }
  }

  private eventKey(event: BotEvent) {
    const poolAddress = event.poolAddress ?? "";
    const tokenMint = event.tokenMint ?? "";
    const walletAddress = event.walletAddress ?? "";
    return [event.type, poolAddress, tokenMint, walletAddress, stableStringify(event.data)].join("|");
  }

  private routeStrategies(event: BotEvent): StrategyDirective[] {
    if (event.type === "strategy:triggered") return [];

    const base = {
      poolAddress: event.poolAddress,
      tokenMint: event.tokenMint,
      walletAddress: event.walletAddress,
      createdAt: new Date(event.ts).toISOString(),
      sourceEventType: event.type,
    } satisfies Omit<StrategyDirective, "id" | "strategy" | "action" | "confidence" | "reasons">;

    switch (event.type) {
      case "pool:new": {
        const directives: StrategyDirective[] = [];
        const keywords = asStringArray(event.data.keywords);
        const bondingCurveProgress = asNumber(event.data.bondingCurveProgressPct);
        if (keywords.some((keyword) => /rug|mintauthority|freezeauthority/i.test(keyword))) {
          directives.push(createDirective(base, "RUG_PULL_SHIELD", "WATCH", 0.98, ["New pool keywords match rug-risk markers"]));
        } else {
          directives.push(createDirective(base, "TICK_RANGE_PROPHET", "WATCH", 0.76, ["New pool discovered, start range estimation"]));
        }
        if ((bondingCurveProgress ?? 0) >= 90) {
          directives.push(createDirective(base, "BONDING_CURVE_ARB", "REBALANCE", 0.92, ["Bonding curve near completion"]));
        }
        return directives;
      }
      case "pool:tvl_drop":
        return [createDirective(base, "RUG_PULL_SHIELD", "REMOVE_LIQUIDITY", 0.99, ["TVL dropped sharply"])];
      case "pool:volume_spike":
        return [createDirective(base, "LIQUIDITY_VACUUM", "ADD_LIQUIDITY", 0.88, ["Volume spike with relative liquidity vacuum"])];
      case "wallet:dev_swap":
        return [createDirective(base, "WALLET_FINGERPRINT", "BLACKLIST", 0.9, ["Creator wallet changed or rotated"])];
      case "wallet:whale_move":
        return [createDirective(base, "WHALE_ADJUST", "REDUCE_EXPOSURE", 0.85, ["Whale pressure increased"])];
      case "token:mint_active":
        return [createDirective(base, "FLASH_LP", "ADD_LIQUIDITY", 0.84, ["Mint activity detected"])];
      case "token:rug_signal":
        return [createDirective(base, "RUG_PULL_SHIELD", "REMOVE_LIQUIDITY", 0.99, ["Rug signal detected"])];
      case "token:migrate":
        return [createDirective(base, "BONDING_CURVE_ARB", "REBALANCE", 0.9, ["Migration or bonding curve event detected"])];
      case "sniper:detected":
        return [createDirective(base, "SNIPER_SHADOW", "HEDGE", 0.87, ["Sniper activity detected"])];
      case "fee:accumulated":
        return [createDirective(base, "FEE_COMPOUNDING_FLYWHEEL", "REPRICE", 0.8, ["Fee accumulation crossed threshold"])];
      case "social:velocity_spike": {
        const delta = asNumber(event.data.socialVelocityDelta) ?? 0;
        const action: StrategyAction = delta >= 0 ? "ADD_LIQUIDITY" : "REMOVE_LIQUIDITY";
        return [createDirective(base, "SOCIAL_VELOCITY", action, Math.min(0.95, 0.82 + Math.abs(delta) / 100), ["Social velocity changed materially"])];
      }
      case "phantom:attacked":
        return [createDirective(base, "PHANTOM_LIQUIDITY", "WAIT", 0.91, ["Phantom liquidity tripwire attacked"])];
      default:
        return [];
    }
  }
}

function isStreamEvent(event: BotEvent) {
  const source = event.data.source;
  return source === "wss" || source === "geyser";
}

function computeOverlap(left: string[], right: string[]) {
  const rightSet = new Set(right.map((value) => value.toLowerCase()));
  return left.reduce((count, value) => count + (rightSet.has(value.toLowerCase()) ? 1 : 0), 0);
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function createDirective(
  base: Omit<StrategyDirective, "id" | "strategy" | "action" | "confidence" | "reasons">,
  strategy: StrategyType,
  action: StrategyAction,
  confidence: number,
  reasons: string[],
): StrategyDirective {
  return {
    id: stableId([base.sourceEventType, base.poolAddress, base.tokenMint, base.walletAddress, strategy, action, reasons.join("|")]),
    ...base,
    strategy,
    action,
    confidence: clamp01(confidence),
    reasons,
  };
}

function stableId(parts: Array<string | undefined>) {
  return parts.filter(Boolean).join(":").replace(/[^a-zA-Z0-9:_-]+/g, "_").slice(0, 96);
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
}
