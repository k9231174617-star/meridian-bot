import { eventBus, type BotEvent } from "./event-bus.js";

export type GeyserClientOptions = {
  enabled?: boolean;
  endpoint?: string;
  token?: string;
  commitment?: "processed" | "confirmed" | "finalized";
};

export class GeyserClient {
  private stopClient?: () => Promise<void>;

  constructor(private readonly options: GeyserClientOptions = {}) {}

  async start() {
    if (this.stopClient) return this.stopClient;
    if (!this.options.enabled || !this.options.endpoint) {
      this.stopClient = async () => undefined;
      return this.stopClient;
    }

    try {
      const loadModule = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<Record<string, unknown>>;
      const mod = await loadModule("@triton-one/yellowstone-grpc");
      const clientFactory = (mod as Record<string, unknown>).Client
        ?? (mod as Record<string, unknown>).GrpcClient
        ?? (mod as Record<string, unknown>).default;

      if (typeof clientFactory !== "function") {
        console.warn("[geyser] Yellowstone gRPC client is unavailable in this runtime");
        this.stopClient = async () => undefined;
        return this.stopClient;
      }

      const client = new (clientFactory as new (endpoint: string, token?: Record<string, string>) => Record<string, unknown>)(
        this.options.endpoint,
        this.options.token ? { "x-token": this.options.token } : undefined,
      );

      const stream = typeof (client as any).subscribe === "function"
        ? (client as any).subscribe()
        : typeof (client as any).stream === "function"
          ? (client as any).stream()
          : undefined;

      if (!stream) {
        console.warn("[geyser] Yellowstone gRPC client did not expose a stream interface");
        this.stopClient = async () => undefined;
        return this.stopClient;
      }

      const onData = (message: unknown) => {
        this.handleMessage(message);
      };

      const onError = (error: unknown) => {
        console.warn("[geyser] stream error", error);
      };

      stream.on?.("data", onData);
      stream.on?.("error", onError);
      stream.on?.("end", onError);

      if (typeof stream.write === "function") {
        stream.write({
          slots: {},
          accounts: {},
          transactions: {},
          blocks: {},
          commitment: this.options.commitment ?? "confirmed",
        });
      }

      this.stopClient = async () => {
        try {
          stream.off?.("data", onData);
          stream.off?.("error", onError);
          stream.off?.("end", onError);
          stream.end?.();
          stream.destroy?.();
        } catch {
          // ignore shutdown errors
        }
      };
      return this.stopClient;
    } catch (error) {
      console.warn("[geyser] Yellowstone gRPC integration unavailable", error);
      this.stopClient = async () => undefined;
      return this.stopClient;
    }
  }

  async stop() {
    const stop = this.stopClient;
    this.stopClient = undefined;
    if (stop) {
      await stop();
    }
  }

  private handleMessage(message: unknown) {
    const event = this.toBotEvent(message);
    if (!event) return;
    eventBus.emit(event.type, event);
  }

  private toBotEvent(message: unknown): BotEvent | null {
    if (!message || typeof message !== "object") return null;
    const payload = message as Record<string, unknown>;
    const logMessages = extractLogMessages(payload);
    const text = logMessages.join(" ").toLowerCase();

    if (text.includes("initialize") || text.includes("create") || text.includes("mint")) {
      return {
        type: "token:mint_active",
        ts: Date.now(),
        data: { source: "geyser", payload },
      };
    }

    if (text.includes("migrate") || text.includes("migration") || text.includes("pump")) {
      return {
        type: "token:migrate",
        ts: Date.now(),
        data: { source: "geyser", payload },
      };
    }

    if (text.includes("sandwich") || text.includes("frontrun") || text.includes("sniper")) {
      return {
        type: "sniper:detected",
        ts: Date.now(),
        data: { source: "geyser", payload },
      };
    }

    if (text.includes("rug") || text.includes("freezeauthority") || text.includes("mintauthority")) {
      return {
        type: "token:rug_signal",
        ts: Date.now(),
        data: { source: "geyser", payload },
      };
    }

    return null;
  }
}

function extractLogMessages(payload: Record<string, unknown>): string[] {
  const candidates = [
    payload.logs,
    payload.logMessages,
    (payload.transaction as Record<string, unknown> | undefined)?.meta && (payload.transaction as Record<string, unknown>).meta,
    payload.message,
  ];

  const logs: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      for (const entry of candidate) {
        if (typeof entry === "string") logs.push(entry);
      }
      continue;
    }
    if (typeof candidate === "object") {
      const meta = candidate as Record<string, unknown>;
      const logEntries = meta.logMessages ?? meta.logs;
      if (Array.isArray(logEntries)) {
        for (const entry of logEntries) {
          if (typeof entry === "string") logs.push(entry);
        }
      }
    }
    if (typeof candidate === "string") {
      logs.push(candidate);
    }
  }
  return logs;
}
