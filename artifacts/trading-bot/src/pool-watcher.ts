import { Connection } from "@solana/web3.js";

export type PoolWatchEvent = {
  signature: string;
  detectedAt: string;
  keywords: string[];
  logs: string[];
  source: "wss";
};

export type PoolWatcherOptions = {
  rpcUrl?: string;
  rpcWsUrl?: string;
  enabled?: boolean;
  logKeywords?: string[];
};

export class PoolWatcher {
  private readonly keywords: string[];
  private readonly seenSignatures = new Set<string>();
  private readonly seenOrder: string[] = [];
  private connection?: Connection;
  private subscriptionId?: number;

  constructor(private readonly options: PoolWatcherOptions = {}) {
    this.keywords = normalizeKeywords(options.logKeywords);
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
    this.subscriptionId = this.connection.onLogs("all", async (logInfo) => {
      if (logInfo.err) return;
      if (this.seenSignatures.has(logInfo.signature)) return;

      const logs = (logInfo.logs ?? []).map(String);
      const keywords = matchKeywords(logs, this.keywords);
      if (keywords.length === 0) return;

      this.seenSignatures.add(logInfo.signature);
      this.seenOrder.push(logInfo.signature);
      if (this.seenOrder.length > 5000) {
        const removed = this.seenOrder.shift();
        if (removed) this.seenSignatures.delete(removed);
      }

      await onEvent({
        signature: logInfo.signature,
        detectedAt: new Date().toISOString(),
        keywords,
        logs,
        source: "wss",
      });
    }, "confirmed");

    return async () => {
      if (typeof this.subscriptionId === "number") {
        try {
          await this.connection?.removeOnLogsListener(this.subscriptionId);
        } catch {
          // ignore shutdown errors
        }
      }
      this.subscriptionId = undefined;
      this.connection = undefined;
    };
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

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}
