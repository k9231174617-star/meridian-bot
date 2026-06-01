import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import type { PoolSnapshot, SupportedDex } from "./domain.js";
import { parseDexList } from "./config.js";

export type DiscoverySettings = {
  enabledDexes: SupportedDex[];
  updatedAt: string;
};

export type DiscoveryCandidate = {
  id: string;
  dex: SupportedDex;
  source: "meteora-api" | "wss-log" | "fallback";
  signature?: string;
  detectedAt: string;
  confidence: number;
  keywords: string[];
  pool: PoolSnapshot;
};

export type DiscoverySettingsInput = {
  enabledDexes?: string[] | SupportedDex[] | string;
};

type DiscoveryRecord =
  | { kind: "settings"; settings: DiscoverySettings }
  | { kind: "candidate"; candidate: DiscoveryCandidate };

export function defaultDiscoverySettings(enabledDexes?: SupportedDex[]): DiscoverySettings {
  return {
    enabledDexes: enabledDexes && enabledDexes.length > 0 ? [...new Set(enabledDexes)] : ["meteora", "raydium", "orca"],
    updatedAt: new Date().toISOString(),
  };
}

export function normalizeDiscoverySettings(input?: DiscoverySettingsInput | null, fallback?: SupportedDex[]): DiscoverySettings {
  if (!input) return defaultDiscoverySettings(fallback);
  const enabledDexes = Array.isArray(input.enabledDexes)
    ? parseDexList(input.enabledDexes.join(","))
    : typeof input.enabledDexes === "string"
      ? parseDexList(input.enabledDexes)
      : fallback ?? ["meteora", "raydium", "orca"];
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
    const enabledDexes = parseDexList(parsed.enabledDexes?.join(","));
    return {
      enabledDexes: enabledDexes.length > 0 ? enabledDexes : (fallback ?? ["meteora", "raydium", "orca"]),
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

export function candidatePoolForDex(
  dex: SupportedDex,
  signature: string,
  confidence: number,
  source: DiscoveryCandidate["source"],
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

async function ensureDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}

export function resolveDiscoverySettingsPath(storageDir?: string) {
  return path.join(resolveDiscoveryDir(storageDir), "discovery-settings.json");
}

export function resolveDiscoveryCandidatesPath(storageDir?: string) {
  return path.join(resolveDiscoveryDir(storageDir), "discovery-candidates.jsonl");
}

export function resolveDiscoveryDir(storageDir?: string) {
  const fallback = path.resolve(process.cwd(), ".bot-data", "trading-bot");
  return storageDir?.trim() ? path.resolve(storageDir) : fallback;
}
