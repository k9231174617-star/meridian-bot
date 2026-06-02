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
    const events = this.toBotEvents(message);
    for (const event of events) {
      eventBus.emit(event.type, event);
    }
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

  private toBotEvents(message: unknown): BotEvent[] {
    if (!message || typeof message !== "object") return [];
    const payload = message as Record<string, unknown>;
    const events: BotEvent[] = [];

    const flowEvent = this.detectLargeFlowEvent(payload);
    if (flowEvent) events.push(flowEvent);

    const logEvent = this.toBotEventFromLogs(payload);
    if (logEvent) events.push(logEvent);

    return events;
  }

  private toBotEventFromLogs(message: Record<string, unknown>): BotEvent | null {
    const payload = message;
    if (!message || typeof message !== "object") return null;
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

  private detectLargeFlowEvent(payload: Record<string, unknown>): BotEvent | null {
    const tx = firstObject(payload.transaction) ?? firstObject(payload.tx) ?? firstObject(payload.message) ?? payload;
    const meta = firstObject(tx.meta) ?? firstObject(payload.meta);
    const preBalances = asNumberArray(meta?.preBalances);
    const postBalances = asNumberArray(meta?.postBalances);
    const lamportDelta = balanceDelta(preBalances, postBalances);
    const tokenDelta = extractLargestTokenDelta(meta);
    const tokenMint = tokenDelta?.mint ?? extractTokenMint(payload);
    const walletAddress = tokenDelta?.owner ?? extractWalletAddress(payload);
    const poolAddress = extractPoolAddress(payload) ?? extractPoolAddress(tx) ?? undefined;

    if (!tokenMint) return null;

    const direction: "buy" | "sell" | null = tokenDelta
      ? tokenDelta.delta > 0
        ? "buy"
        : tokenDelta.delta < 0
          ? "sell"
          : null
      : lamportDelta < 0
        ? "buy"
        : lamportDelta > 0
          ? "sell"
          : null;

    if (!direction) return null;

    const absLamports = Math.abs(lamportDelta);
    const absTokenDelta = Math.abs(tokenDelta?.delta ?? 0);
    const estimatedUsd = estimateUsdFromFlow({
      lamports: absLamports,
      tokenDelta: absTokenDelta,
      meta,
      payload,
    });
    const confidence = clamp01(
      0.55 +
        Math.min(0.25, absLamports / 10_000_000_000) +
        Math.min(0.1, absTokenDelta / 10_000) +
        (poolAddress ? 0.05 : 0),
    );

    if (absLamports < 250_000_000 && absTokenDelta < 100) return null;

    return {
      type: direction === "buy" ? "mempool:large_buy" : "mempool:large_sell",
      ts: Date.now(),
      poolAddress,
      tokenMint,
      walletAddress,
      data: {
        source: "geyser",
        payload,
        direction,
        lamportDelta,
        tokenDelta: tokenDelta?.delta ?? 0,
        estimatedUsd,
        confidence: round2(confidence),
        poolAddress,
        tokenMint,
        walletAddress,
      },
    };
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

function firstObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function asNumberArray(value: unknown): number[] {
  return Array.isArray(value)
    ? value
        .map((entry) => (typeof entry === "number" && Number.isFinite(entry) ? entry : Number(entry)))
        .filter((entry) => Number.isFinite(entry))
    : [];
}

function balanceDelta(pre: number[], post: number[]) {
  const length = Math.max(pre.length, post.length);
  let delta = 0;
  for (let index = 0; index < length; index += 1) {
    delta += (post[index] ?? 0) - (pre[index] ?? 0);
  }
  return delta;
}

type TokenBalanceDelta = { mint: string; owner?: string; delta: number };

function extractLargestTokenDelta(meta: Record<string, unknown> | undefined): TokenBalanceDelta | null {
  if (!meta) return null;
  const pre = Array.isArray(meta.preTokenBalances) ? meta.preTokenBalances : [];
  const post = Array.isArray(meta.postTokenBalances) ? meta.postTokenBalances : [];
  const byKey = new Map<string, { pre?: Record<string, unknown>; post?: Record<string, unknown> }>();

  for (const entry of pre) {
    const record = firstObject(entry);
    const key = tokenBalanceKey(record);
    if (!key) continue;
    byKey.set(key, { ...(byKey.get(key) ?? {}), pre: record });
  }

  for (const entry of post) {
    const record = firstObject(entry);
    const key = tokenBalanceKey(record);
    if (!key) continue;
    byKey.set(key, { ...(byKey.get(key) ?? {}), post: record });
  }

  let largest: TokenBalanceDelta | null = null;
  for (const entry of byKey.values()) {
    const mint = typeof entry.post?.mint === "string" ? entry.post.mint : typeof entry.pre?.mint === "string" ? entry.pre.mint : "";
    if (!mint) continue;
    const owner = typeof entry.post?.owner === "string" ? entry.post.owner : typeof entry.pre?.owner === "string" ? entry.pre.owner : undefined;
    const preAmount = tokenBalanceAmount(entry.pre);
    const postAmount = tokenBalanceAmount(entry.post);
    const delta = postAmount - preAmount;
    if (!largest || Math.abs(delta) > Math.abs(largest.delta)) {
      largest = { mint, owner, delta };
    }
  }
  return largest;
}

function tokenBalanceKey(entry: Record<string, unknown> | undefined) {
  if (!entry) return null;
  const accountIndex = typeof entry.accountIndex === "number" ? entry.accountIndex : undefined;
  const mint = typeof entry.mint === "string" ? entry.mint : undefined;
  if (typeof accountIndex === "number" && mint) return `${accountIndex}:${mint}`;
  if (mint) return mint;
  return null;
}

function tokenBalanceAmount(entry: Record<string, unknown> | undefined) {
  if (!entry) return 0;
  const uiAmount = entry.uiTokenAmount && typeof entry.uiTokenAmount === "object"
    ? (entry.uiTokenAmount as Record<string, unknown>)
    : undefined;
  const amount = uiAmount?.uiAmount;
  if (typeof amount === "number" && Number.isFinite(amount)) return amount;
  const raw = typeof entry.amount === "string" ? Number(entry.amount) : typeof entry.amount === "number" ? entry.amount : NaN;
  if (!Number.isFinite(raw)) return 0;
  const decimals = typeof uiAmount?.decimals === "number" ? uiAmount.decimals : typeof entry.decimals === "number" ? entry.decimals : 0;
  return raw / 10 ** Math.max(0, decimals);
}

function extractTokenMint(payload: Record<string, unknown>) {
  const candidates = [
    payload.tokenMint,
    payload.mint,
    firstObject(payload.token)?.mint,
    firstObject(payload.account)?.mint,
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

function extractWalletAddress(payload: Record<string, unknown>) {
  const candidates = [
    payload.walletAddress,
    payload.owner,
    firstObject(payload.account)?.owner,
    firstObject(payload.signer)?.pubkey,
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

function extractPoolAddress(payload: Record<string, unknown>) {
  const candidates = [
    payload.poolAddress,
    payload.address,
    payload.accountAddress,
    firstObject(payload.account)?.address,
    firstObject(payload.pool)?.address,
  ];
  return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

function estimateUsdFromFlow(params: { lamports: number; tokenDelta: number; meta?: Record<string, unknown>; payload: Record<string, unknown> }) {
  const explicit = [
    params.payload.estimatedUsd,
    params.payload.sizeUsd,
    params.payload.valueUsd,
    params.meta?.estimatedUsd,
  ].find((value) => typeof value === "number" && Number.isFinite(value));
  if (typeof explicit === "number") return explicit;
  const solPriceUsd = 150;
  const lamportUsd = params.lamports / 1_000_000_000 * solPriceUsd;
  return round2(Math.max(lamportUsd, params.tokenDelta));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
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
