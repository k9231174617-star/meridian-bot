import { eventBus, type BotEvent } from "./event-bus.js";
import {
  METEORA_DLMM_PROGRAM,
  ORCA_WHIRLPOOL_PROGRAM,
  RAYDIUM_CLMM_PROGRAM,
  RAYDIUM_CPMM_PROGRAM,
  TOKEN_2022_PROGRAM,
  TOKEN_PROGRAM,
} from "../execution/protocol-ids.js";

export type GeyserClientOptions = {
  enabled?: boolean;
  endpoint?: string;
  token?: string;
  commitment?: "processed" | "confirmed" | "finalized";
  programIds?: string[];
  accountOwners?: string[];
  accountInclude?: string[];
  pingIntervalMs?: number;
  onStatus?: (status: GeyserStatus) => void;
  onError?: (error: unknown) => void;
};

export type GeyserStatus = "idle" | "connecting" | "connected" | "degraded" | "closed" | "error";

export class GeyserClient {
  private stopClient?: () => Promise<void>;
  private status: GeyserStatus = "idle";

  constructor(private readonly options: GeyserClientOptions = {}) {}

  async start() {
    if (this.stopClient) return this.stopClient;
    if (!this.options.enabled || !this.options.endpoint) {
      this.setStatus("idle");
      this.stopClient = async () => undefined;
      return this.stopClient;
    }

    try {
      this.setStatus("connecting");
      const loadModule = new Function("specifier", "return import(specifier);") as (specifier: string) => Promise<Record<string, unknown>>;
      const mod = await loadModule("@triton-one/yellowstone-grpc");
      const clientFactory = (mod as Record<string, unknown>).Client
        ?? (mod as Record<string, unknown>).GrpcClient
        ?? (mod as Record<string, unknown>).default;

      if (typeof clientFactory !== "function") {
        console.warn("[geyser] Yellowstone gRPC client is unavailable in this runtime");
        this.setStatus("error");
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
        this.setStatus("error");
        this.stopClient = async () => undefined;
        return this.stopClient;
      }

      let heartbeat: NodeJS.Timeout | undefined;
      let connected = false;
      const onData = (message: unknown) => {
        if (!connected) {
          connected = true;
          this.setStatus("connected");
        }
        this.handleMessage(message);
      };

      const onError = (error: unknown) => {
        console.warn("[geyser] stream error", error);
        this.setStatus("degraded");
        this.options.onError?.(error);
      };

      stream.on?.("data", onData);
      stream.on?.("error", onError);
      stream.on?.("end", onError);
      stream.on?.("close", onError);

      if (typeof stream.write === "function") {
        const request = this.buildSubscribeRequest();
        stream.write(request);
        if (typeof this.options.pingIntervalMs === "number" && this.options.pingIntervalMs > 0) {
          heartbeat = setInterval(() => {
            try {
              stream.write({ ping: { id: Date.now() & 0xffff } });
            } catch (error) {
              onError(error);
            }
          }, this.options.pingIntervalMs);
        }
      }

      this.stopClient = async () => {
        try {
          if (heartbeat) clearInterval(heartbeat);
          stream.off?.("data", onData);
          stream.off?.("error", onError);
          stream.off?.("end", onError);
          stream.off?.("close", onError);
          stream.end?.();
          stream.destroy?.();
        } catch {
          // ignore shutdown errors
        }
        this.setStatus("closed");
      };
      this.setStatus("connected");
      return this.stopClient;
    } catch (error) {
      console.warn("[geyser] Yellowstone gRPC integration unavailable", error);
      this.setStatus("error");
      this.options.onError?.(error);
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

  getStatus() {
    return this.status;
  }

  private handleMessage(message: unknown) {
    const event = this.toBotEvent(message);
    if (!event) return;
    eventBus.emit(event.type, event);
  }

  private buildSubscribeRequest() {
    const programIds = uniqueStrings(this.options.programIds ?? defaultProgramIds());
    const accountOwners = uniqueStrings(this.options.accountOwners ?? programIds);
    const accountInclude = uniqueStrings(this.options.accountInclude ?? programIds);
    return {
      commitment: this.options.commitment ?? "confirmed",
      ping: { id: Date.now() & 0xffff },
      accounts: {
        dex_accounts: {
          owner: accountOwners,
          account: accountInclude,
          filters: [],
        },
      },
      transactionsStatus: {
        dex_transactions_status: {
          vote: false,
          failed: false,
          signature: "",
          accountInclude,
          accountExclude: [],
          accountRequired: accountInclude,
        },
      },
      transactions: {
        dex_transactions: {
          vote: false,
          failed: false,
          signature: "",
          accountInclude,
          accountExclude: [],
          accountRequired: accountInclude,
        },
      },
      slots: {
        all_slots: {
          filterByCommitment: true,
        },
      },
      blocks: {
        dex_blocks: {
          accountInclude,
          includeTransactions: true,
          includeAccounts: true,
          includeEntries: false,
        },
      },
      blocksMeta: {},
      entry: {},
      accountsDataSlice: [],
    };
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

  private setStatus(status: GeyserStatus) {
    if (this.status === status) return;
    this.status = status;
    try {
      this.options.onStatus?.(status);
    } catch (error) {
      console.warn("[geyser] status callback failed", error);
    }
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

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function defaultProgramIds() {
  return [
    TOKEN_PROGRAM.toBase58(),
    TOKEN_2022_PROGRAM.toBase58(),
    METEORA_DLMM_PROGRAM.toBase58(),
    RAYDIUM_CLMM_PROGRAM.toBase58(),
    RAYDIUM_CPMM_PROGRAM.toBase58(),
    ORCA_WHIRLPOOL_PROGRAM.toBase58(),
  ];
}
