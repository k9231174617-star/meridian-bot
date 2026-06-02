import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { PublicKey } from "@solana/web3.js";
import type { PoolSnapshot, SupportedDex } from "./domain.js";
import { parseDexList } from "./config.js";
import {
  METEORA_DLMM_PROGRAM,
  ORCA_WHIRLPOOL_PROGRAM,
  RAYDIUM_CLMM_PROGRAM,
  RAYDIUM_CPMM_PROGRAM,
} from "./execution/protocol-ids.js";

export type DiscoverySettings = {
  enabledDexes: SupportedDex[];
  updatedAt: string;
};

export type DiscoveryCandidate = {
  id: string;
  dex: SupportedDex;
  source: "meteora-api" | "wss-log" | "wss-program" | "rpc-recent" | "rpc-account" | "fallback";
  signature?: string;
  detectedAt: string;
  confidence: number;
  keywords: string[];
  pool: PoolSnapshot;
};

export type DiscoveryObservation = {
  id: string;
  dex?: SupportedDex;
  source: DiscoveryCandidate["source"];
  signature?: string;
  detectedAt: string;
  keywords: string[];
  status: "accepted" | "rejected";
  reason: string;
  accounts?: string[];
};

export type DiscoverySettingsInput = {
  enabledDexes?: string[] | SupportedDex[] | string;
};

type DiscoveryRecord =
  | { kind: "settings"; settings: DiscoverySettings }
  | { kind: "candidate"; candidate: DiscoveryCandidate }
  | { kind: "observation"; observation: DiscoveryObservation };

export function defaultDiscoverySettings(enabledDexes?: SupportedDex[]): DiscoverySettings {
  const fallbackDexes = enabledDexes ? [...new Set(enabledDexes)] : undefined;
  return {
    enabledDexes: fallbackDexes ?? ["meteora", "raydium", "orca"],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeDiscoverySettings(input?: DiscoverySettingsInput | null, fallback?: SupportedDex[]): DiscoverySettings {
  if (!input) return defaultDiscoverySettings(fallback);
  const enabledDexes = parseDiscoveryDexEntries(input.enabledDexes, fallback);
  return {
    enabledDexes,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadDiscoverySettings(storageDir?: string, fallback?: SupportedDex[]): Promise<DiscoverySettings> {
  const file = resolveDiscoverySettingsPath(storageDir);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as Partial<DiscoverySettings>;
    return {
      enabledDexes: parseDiscoveryDexEntries(parsed.enabledDexes, fallback),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return defaultDiscoverySettings(fallback);
  }
}

export async function saveDiscoverySettings(storageDir: string | undefined, settings: DiscoverySettings): Promise<void> {
  const file = resolveDiscoverySettingsPath(storageDir);
  await ensureDir(file);
  await writeFile(file, `${JSON.stringify({ ...settings, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

export async function appendDiscoveryCandidate(storageDir: string | undefined, candidate: DiscoveryCandidate): Promise<void> {
  const file = resolveDiscoveryCandidatesPath(storageDir);
  await ensureDir(file);
  const record: DiscoveryRecord = { kind: "candidate", candidate };
  await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

export async function appendDiscoveryObservation(storageDir: string | undefined, observation: DiscoveryObservation): Promise<void> {
  const file = resolveDiscoveryObservationsPath(storageDir);
  await ensureDir(file);
  const record: DiscoveryRecord = { kind: "observation", observation };
  await appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

export async function loadDiscoveryCandidates(storageDir?: string, limit = 50): Promise<DiscoveryCandidate[]> {
  try {
    const raw = await readFile(resolveDiscoveryCandidatesPath(storageDir), "utf8");
    const records = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as DiscoveryRecord];
        } catch {
          return [];
        }
      });

    return records
      .filter((record): record is Extract<DiscoveryRecord, { kind: "candidate" }> => record.kind === "candidate")
      .map((record) => record.candidate)
      .slice(-limit);
  } catch {
    return [];
  }
}

export async function loadDiscoveryObservations(storageDir?: string, limit = 50): Promise<DiscoveryObservation[]> {
  try {
    const raw = await readFile(resolveDiscoveryObservationsPath(storageDir), "utf8");
    const records = raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as DiscoveryRecord];
        } catch {
          return [];
        }
      });

    return records
      .filter((record): record is Extract<DiscoveryRecord, { kind: "observation" }> => record.kind === "observation")
      .map((record) => record.observation)
      .slice(-limit);
  } catch {
    return [];
  }
}

export function detectDexFromLogs(logs: string[]): SupportedDex[] {
  const normalized = logs.map((entry) => entry.toLowerCase());
  const matches = new Set<SupportedDex>();
  if (normalized.some((entry) => entry.includes("meteora") || entry.includes("lb_pair") || entry.includes("dlmm"))) {
    matches.add("meteora");
  }
  if (normalized.some((entry) => entry.includes("raydium"))) {
    matches.add("raydium");
  }
  if (normalized.some((entry) => entry.includes("whirlpool") || entry.includes("orca"))) {
    matches.add("orca");
  }
  return [...matches];
}

export function programIdsForDex(dex: SupportedDex): PublicKey[] {
  if (dex === "meteora") return [METEORA_DLMM_PROGRAM];
  if (dex === "raydium") return [RAYDIUM_CLMM_PROGRAM, RAYDIUM_CPMM_PROGRAM];
  return [ORCA_WHIRLPOOL_PROGRAM];
}

type DiscoveryConnection = {
  getSignaturesForAddress(address: PublicKey, options?: { limit?: number }): Promise<Array<{ signature: string; blockTime?: number | null } & Record<string, unknown>>>;
  getParsedTransaction?(signature: string, options?: Record<string, unknown>): Promise<unknown>;
  getTransaction?(signature: string, options?: Record<string, unknown>): Promise<unknown>;
};

export async function discoverRecentProgramCandidates(connection: DiscoveryConnection, enabledDexes: SupportedDex[], seenSignatures: Set<string>, limitPerDex = 5) {
  const candidates: DiscoveryCandidate[] = [];
  const observations: DiscoveryObservation[] = [];
  for (const dex of enabledDexes) {
    for (const programId of programIdsForDex(dex)) {
      const signatures = await connection.getSignaturesForAddress(programId, { limit: limitPerDex });
      for (const info of signatures) {
        if (seenSignatures.has(info.signature)) continue;
        const tx = await fetchTransaction(connection, info.signature, {
          commitment: "confirmed",
          maxSupportedTransactionVersion: 0,
        } as never);
        const logs = extractLogMessages(tx);
        const detectedDexes = detectDexFromLogs(logs);
        const detectedAt = info.blockTime ? new Date(info.blockTime * 1000).toISOString() : new Date().toISOString();
        const keywords = matchDiscoveryKeywords(logs);
        if (detectedDexes.length === 0 && !matchesDexProgram(tx, programId)) {
          observations.push(buildDiscoveryObservation({
            dex,
            signature: info.signature,
            detectedAt,
            keywords,
            source: "rpc-recent",
            status: "rejected",
            reason: "No DEX program markers detected in recent transaction",
          }));
          continue;
        }
        const accounts = extractAccountAddresses(tx);
        const candidateAddress = inferPoolAddress(accounts, dex) ?? inferAccountLevelPoolAddress(accounts, dex, info.signature);
        if (!candidateAddress) {
          observations.push(buildDiscoveryObservation({
            dex,
            signature: info.signature,
            detectedAt,
            keywords,
            source: "rpc-account",
            status: "rejected",
            reason: "Could not infer pool account from transaction accounts",
            accounts,
          }));
          continue;
        }
        const resolvedDexes = detectedDexes.length > 0 ? detectedDexes : [dex];
        for (const resolvedDex of resolvedDexes) {
          const signature = info.signature;
          const confidence = keywords.length > 0 ? 0.86 : 0.76;
          const candidate = buildDiscoveryCandidate({
            dex: resolvedDex,
            signature,
            detectedAt,
            keywords,
            confidence,
            source: "rpc-account",
          });
          candidate.pool.address = candidateAddress;
          candidates.push(candidate);
          observations.push(buildDiscoveryObservation({
            dex: resolvedDex,
            signature,
            detectedAt,
            keywords,
            source: "rpc-account",
            status: "accepted",
            reason: "Inferred pool account from transaction accounts",
            accounts,
          }));
          seenSignatures.add(signature);
        }
      }
    }
  }
  return { candidates, observations };
}

export function buildDiscoveryCandidate(input: {
  dex: SupportedDex;
  signature?: string;
  detectedAt: string;
  keywords: string[];
  confidence?: number;
  source?: DiscoveryCandidate["source"];
}): DiscoveryCandidate {
  const signature = input.signature ?? `${input.dex}-${input.detectedAt}`;
  const suffix = signature.slice(0, 8);
  const baseName = `${input.dex.toUpperCase()} DISCOVERY ${suffix}`;
  const pool = candidatePoolForDex(input.dex, signature, input.confidence ?? 0.5, input.source ?? "wss-log", input.detectedAt, baseName);
  return {
    id: createCandidateId(input.dex, signature),
    dex: input.dex,
    source: input.source ?? "wss-log",
    signature,
    detectedAt: input.detectedAt,
    confidence: input.confidence ?? 0.5,
    keywords: [...new Set(input.keywords)],
    pool,
  };
}

export function buildDiscoveryObservation(input: {
  dex?: SupportedDex;
  signature?: string;
  detectedAt: string;
  keywords: string[];
  source: DiscoveryObservation["source"];
  status: DiscoveryObservation["status"];
  reason: string;
  accounts?: string[];
}): DiscoveryObservation {
  const signature = input.signature ?? `${input.dex ?? "unknown"}-${input.detectedAt}`;
  return {
    id: `${input.status}:${input.source}:${signature.slice(0, 32)}`,
    dex: input.dex,
    source: input.source,
    signature,
    detectedAt: input.detectedAt,
    keywords: [...new Set(input.keywords)],
    status: input.status,
    reason: input.reason,
    ...(input.accounts && input.accounts.length > 0 ? { accounts: [...new Set(input.accounts)] } : {}),
  };
}

export function candidatePoolForDex(
  dex: SupportedDex,
  signature: string,
  confidence: number,
  source: "meteora-api" | "wss-log" | "wss-program" | "rpc-recent" | "rpc-account" | "fallback",
  detectedAt: string,
  name?: string,
): PoolSnapshot {
  const baseAddress = `discovery-${dex}-${signature.slice(0, 16)}`;
  const tokenX = dex === "meteora" ? "MEME" : dex === "raydium" ? "RAY" : "ORCA";
  const tokenY = "SOL";
  return {
    address: baseAddress,
    name: name ?? `${dex.toUpperCase()} DISCOVERY ${signature.slice(0, 8)}`,
    dex,
    tokenX,
    tokenY,
    tokenXDecimals: 6,
    tokenYDecimals: 9,
    createdAt: detectedAt,
    mintAuthorityRevoked: undefined,
    freezeAuthorityRevoked: undefined,
    liquidityLocked: undefined,
    topHolderSharePct: undefined,
    topTenHolderSharePct: undefined,
    rugRiskScore: undefined,
    tokenSafetyScore: undefined,
    degenScore: undefined,
    holderGini: undefined,
    devWalletAgeDays: undefined,
    previousRugsByDev: undefined,
    contractRiskScore: undefined,
    bondingCurveProgressPct: undefined,
    migrateTarget: undefined,
    socialVelocityScore: dex === "meteora" ? 65 : 58,
    socialVelocityDelta: 0,
    whaleFlowBps: 0,
    whalePressureScore: 35,
    fdvUsd: 0,
    eventWindowActive: false,
    tvlUsd: dex === "meteora" ? 180_000 : dex === "raydium" ? 140_000 : 120_000,
    volume24hUsd: 0,
    fee24hUsd: 0,
    feeRatePct: 0,
    binStep: dex === "meteora" ? 1 : 4,
    signalScore: dex === "meteora" ? 74 : dex === "raydium" ? 68 : 66,
    jupScore: dex === "meteora" ? 72 : 66,
    smartMoneyScore: confidence >= 0.6 ? 64 : 56,
    ilRisk: dex === "meteora" ? "MEDIUM" : "HIGH",
    signalSeed: "WATCH",
    currentPrice: dex === "orca" ? 1 : 0,
    activeBinId: 0,
    discoveryConfidence: confidence,
    discoverySource: source,
    discoverySignature: signature,
    isDiscoveryCandidate: true,
  };
}

export function mergeDiscoveredPools(basePools: PoolSnapshot[], candidates: DiscoveryCandidate[], enabledDexes: SupportedDex[]) {
  const enabled = new Set(enabledDexes);
  const pools = [...basePools];
  for (const candidate of candidates) {
    if (!enabled.has(candidate.dex)) continue;
    if (pools.some((pool) => pool.address === candidate.pool.address)) continue;
    pools.push(candidate.pool);
  }
  return pools;
}

function createCandidateId(dex: SupportedDex, signature: string) {
  return `${dex}:${signature.slice(0, 32)}`;
}

async function fetchTransaction(connection: DiscoveryConnection, signature: string, options?: Record<string, unknown>) {
  if (typeof connection.getParsedTransaction === "function") {
    return connection.getParsedTransaction(signature, options);
  }
  if (typeof connection.getTransaction === "function") {
    return connection.getTransaction(signature, options);
  }
  return null;
}

function extractAccountAddresses(tx: any) {
  const message = tx?.transaction?.message;
  if (!message) return [];
  const accountKeys = message.accountKeys ?? message.staticAccountKeys ?? [];
  return accountKeys
    .map((entry: any) => {
      if (!entry) return undefined;
      if (typeof entry === "string") return entry;
      if (typeof entry.toBase58 === "function") return entry.toBase58();
      if (entry.pubkey && typeof entry.pubkey.toBase58 === "function") return entry.pubkey.toBase58();
      if (typeof entry.pubkey === "string") return entry.pubkey;
      return undefined;
    })
    .filter((value: string | undefined): value is string => Boolean(value));
}

function inferPoolAddress(accounts: string[], dex: SupportedDex) {
  const blacklist = new Set([
    METEORA_DLMM_PROGRAM.toBase58(),
    RAYDIUM_CLMM_PROGRAM.toBase58(),
    RAYDIUM_CPMM_PROGRAM.toBase58(),
    ORCA_WHIRLPOOL_PROGRAM.toBase58(),
  ]);
  const preferred = accounts.find((account) => !blacklist.has(account) && account.length >= 32);
  if (preferred) return preferred;
  if (accounts.length > 0) return accounts[0];
  return undefined;
}

function inferAccountLevelPoolAddress(accounts: string[], dex: SupportedDex, signature: string) {
  if (accounts.length === 0) return `discovery-${dex}-${signature.slice(0, 16)}`;
  return inferPoolAddress(accounts, dex) ?? `discovery-${dex}-${signature.slice(0, 16)}`;
}

function matchDiscoveryKeywords(logs: string[]) {
  const keywords = ["initialize", "create", "lb_pair", "whirlpool", "raydium", "meteora", "open_position", "pool", "pair"];
  const normalizedLogs = logs.map((entry) => entry.toLowerCase());
  return keywords.filter((keyword) => normalizedLogs.some((entry) => entry.includes(keyword)));
}

type TransactionLike = any;

function extractLogMessages(tx: TransactionLike) {
  return (tx?.meta?.logMessages ?? []).map(String);
}

function matchesDexProgram(tx: TransactionLike, programId: PublicKey) {
  const instructions = tx?.transaction?.message?.compiledInstructions ?? [];
  const accountKeys = tx?.transaction?.message?.staticAccountKeys ?? tx?.transaction?.message?.accountKeys ?? [];
  return instructions.some((instruction: { programIdIndex: number }) => accountKeys[instruction.programIdIndex]?.toBase58?.() === programId.toBase58());
}

async function ensureDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export function resolveDiscoverySettingsPath(storageDir?: string) {
  return path.join(resolveDiscoveryDir(storageDir), "discovery-settings.json");
}

export function resolveDiscoveryCandidatesPath(storageDir?: string) {
  return path.join(resolveDiscoveryDir(storageDir), "discovery-candidates.jsonl");
}

export function resolveDiscoveryObservationsPath(storageDir?: string) {
  return path.join(resolveDiscoveryDir(storageDir), "discovery-observations.jsonl");
}

export function resolveDiscoveryDir(storageDir?: string) {
  const fallback = path.resolve(process.cwd(), ".bot-data", "trading-bot");
  return storageDir?.trim() ? path.resolve(storageDir) : fallback;
}

function parseDiscoveryDexEntries(value: unknown, fallback?: SupportedDex[]) {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is SupportedDex => entry === "meteora" || entry === "raydium" || entry === "orca");
  }

  if (typeof value === "string") {
    return value
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry): entry is SupportedDex => entry === "meteora" || entry === "raydium" || entry === "orca");
  }

  return fallback ?? ["meteora", "raydium", "orca"];
}
