import { Connection } from "@solana/web3.js";
import type { SupportedDex } from "./domain.js";
import { detectDexFromLogs } from "./dex-discovery.js";
import { METEORA_DLMM_PROGRAM, ORCA_WHIRLPOOL_PROGRAM, RAYDIUM_CLMM_PROGRAM, RAYDIUM_CPMM_PROGRAM } from "./execution/protocol-ids.js";

export type PoolWatchEvent = {
  signature: string;
  detectedAt: string;
  keywords: string[];
  logs: string[];
  dexes: SupportedDex[];
  programIds: string[];
  source: "wss";
};

export type PoolWatcherOptions = {
  rpcUrl?: string;
  rpcWsUrl?: string;
  enabled?: boolean;
  logKeywords?: string[];
  enabledDexes?: SupportedDex[];
};

export class PoolWatcher {
  private readonly keywords: string[];
  private readonly enabledDexes: SupportedDex[];
  private readonly seenSignatures = new Set<string>();
  private readonly seenOrder: string[] = [];
  private connection?: Connection;
  private subscriptionIds: number[] = [];

  constructor(private readonly options: PoolWatcherOptions = {}) {
    this.keywords = normalizeKeywords(options.logKeywords);
    this.enabledDexes = options.enabledDexes ?? ["meteora", "raydium", "orca"];
  }

  async start(onEvent: (event: PoolWatchEvent) => void | Promise<void>) {
    if (!this.options.enabled) {
      return async () => undefined;
    }

    const rpcUrl = this.options.rpcUrl ?? "https://api.mainnet-beta.solana.com";
    const wsEndpoint = this.options.rpcWsUrl;
    this.connection = wsEndpoint
      ? new Connection(rpcUrl, { commitment: "confirmed", wsEndpoint })
      : new Connection(rpcUrl, "confirmed");

    this.subscriptionIds.push(this.connection.onLogs("all", async (logInfo) => {
      await this.handleLog(logInfo.signature, (logInfo.logs ?? []).map(String), onEvent);
    }, "confirmed"));

    for (const dex of this.enabledDexes) {
      for (const programId of programIdsForDex(dex)) {
        this.subscriptionIds.push(this.connection.onLogs(programId, async (logInfo) => {
          await this.handleLog(logInfo.signature, (logInfo.logs ?? []).map(String), onEvent, [dex], [programId.toBase58()]);
        }, "confirmed"));
      }
    }

    return async () => {
      for (const subscriptionId of this.subscriptionIds) {
        try {
          await this.connection?.removeOnLogsListener(subscriptionId);
        } catch {
          // ignore shutdown errors
        }
      }
      this.subscriptionIds = [];
      this.connection = undefined;
    };
  }

  private async handleLog(signature: string, logs: string[], onEvent: (event: PoolWatchEvent) => void | Promise<void>, explicitDexes: SupportedDex[] = [], programIds: string[] = []) {
    if (this.seenSignatures.has(signature)) return;
    const keywords = matchKeywords(logs, this.keywords);
    const dexes = explicitDexes.length > 0 ? explicitDexes : detectDexFromLogs(logs);
    if (keywords.length === 0 && dexes.length === 0) return;

    this.seenSignatures.add(signature);
    this.seenOrder.push(signature);
    if (this.seenOrder.length > 5000) {
      const removed = this.seenOrder.shift();
      if (removed) this.seenSignatures.delete(removed);
    }

    await onEvent({
      signature,
      detectedAt: new Date().toISOString(),
      keywords,
      logs,
      dexes,
      programIds,
      source: explicitDexes.length > 0 ? "wss" : "wss",
    });
  }
}

export function matchKeywords(logs: string[], keywords: string[]) {
  const normalizedLogs = logs.map((log) => normalizeText(log));
  return keywords.filter((keyword) => {
    const needle = normalizeText(keyword);
    return normalizedLogs.some((log) => log.includes(needle));
  });
}

function normalizeKeywords(keywords: string[] | undefined) {
  return [...new Set((keywords ?? []).map((keyword) => keyword.trim()).filter(Boolean))];
}

function programIdsForDex(dex: SupportedDex) {
  if (dex === "meteora") return [METEORA_DLMM_PROGRAM];
  if (dex === "raydium") return [RAYDIUM_CLMM_PROGRAM, RAYDIUM_CPMM_PROGRAM];
  return [ORCA_WHIRLPOOL_PROGRAM];
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
