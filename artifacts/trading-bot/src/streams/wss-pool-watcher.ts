import type { PoolWatchEvent, PoolWatcherOptions } from "../pool-watcher.js";
import { PoolWatcher } from "../pool-watcher.js";
import { eventBus, type BotEvent } from "./event-bus.js";

export type WssPoolWatcherOptions = PoolWatcherOptions;

export class WssPoolWatcher {
  private readonly watcher: PoolWatcher;
  private stopWatcher?: () => Promise<void>;

  constructor(options: WssPoolWatcherOptions = {}) {
    this.watcher = new PoolWatcher(options);
  }

  async start() {
    if (this.stopWatcher) return this.stopWatcher;
    this.stopWatcher = await this.watcher.start(async (event) => {
      this.publishPoolEvent(event);
    });
    return this.stopWatcher;
  }

  async stop() {
    const stop = this.stopWatcher;
    this.stopWatcher = undefined;
    if (stop) {
      await stop();
    }
  }

  private publishPoolEvent(event: PoolWatchEvent) {
    const base = this.toEvent(event);
    eventBus.emit("pool:new", base);

    if (hasAnyKeyword(event.keywords, ["migrate", "migration", "migrated", "pump", "swap"])) {
      eventBus.emit("token:migrate", {
        ...base,
        type: "token:migrate",
      });
    }

    if (hasAnyKeyword(event.keywords, ["sniper", "sandwich", "frontrun", "bundle"])) {
      eventBus.emit("sniper:detected", {
        ...base,
        type: "sniper:detected",
      });
    }

    if (hasAnyKeyword(event.keywords, ["mint", "initialize", "create", "launch"])) {
      eventBus.emit("token:mint_active", {
        ...base,
        type: "token:mint_active",
      });
    }
  }

  private toEvent(event: PoolWatchEvent): BotEvent {
    return {
      type: "pool:new",
      ts: Date.now(),
      poolAddress: event.programIds[0],
      data: {
        signature: event.signature,
        detectedAt: event.detectedAt,
        keywords: event.keywords,
        logs: event.logs,
        dexes: event.dexes,
        programIds: event.programIds,
        source: event.source,
      },
    };
  }
}

function hasAnyKeyword(keywords: string[], needles: string[]) {
  const normalized = keywords.map(normalizeText);
  return needles.some((needle) => {
    const target = normalizeText(needle);
    return normalized.some((keyword) => keyword.includes(target));
  });
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}
