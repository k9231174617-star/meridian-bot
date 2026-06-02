import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";

export type SupportedDex = "meteora" | "raydium" | "orca";

export type DiscoverySettings = {
  enabledDexes: SupportedDex[];
  updatedAt: string;
};

export type DiscoveryCandidate = {
  id: string;
  dex: SupportedDex;
  source: "meteora-api" | "wss-log" | "wss-program" | "rpc-recent" | "fallback";
  signature?: string;
  detectedAt: string;
  confidence: number;
  keywords: string[];
  pool: Record<string, unknown>;
};

type DiscoveryRecord =
  | { kind: "settings"; settings: DiscoverySettings }
  | { kind: "candidate"; candidate: DiscoveryCandidate };

export function parseDexList(value: string | undefined): SupportedDex[] {
  const enabled = [...new Set((value ?? "").split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))] as string[];
  const dexes: SupportedDex[] = [];
  for (const entry of enabled) {
    if (entry === "meteora" || entry === "raydium" || entry === "orca") {
      dexes.push(entry);
    }
  }
  return dexes.length > 0 ? dexes : ["meteora", "raydium", "orca"];
}

export function normalizeDiscoverySettings(input?: { enabledDexes?: unknown } | null, fallback?: SupportedDex[]): DiscoverySettings {
  const enabledDexes = Array.isArray(input?.enabledDexes)
    ? parseDexList((input.enabledDexes as string[]).join(","))
    : typeof input?.enabledDexes === "string"
      ? parseDexList(input.enabledDexes)
      : fallback ?? ["meteora", "raydium", "orca"];
  return {
    enabledDexes,
    updatedAt: new Date().toISOString(),
  };
}

export async function loadDiscoverySettings(storageDir?: string, fallback?: SupportedDex[]): Promise<DiscoverySettings> {
  try {
    const raw = await readFile(resolveDiscoverySettingsPath(storageDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<DiscoverySettings>;
    return {
      enabledDexes: parseDexList(parsed.enabledDexes?.join(",")) ?? (fallback ?? ["meteora", "raydium", "orca"]),
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return {
      enabledDexes: fallback ?? ["meteora", "raydium", "orca"],
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function saveDiscoverySettings(storageDir: string | undefined, settings: DiscoverySettings): Promise<void> {
  const file = resolveDiscoverySettingsPath(storageDir);
  await ensureDir(file);
  await writeFile(file, `${JSON.stringify({ ...settings, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
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

export function mergeDiscoveredPools(basePools: any[], candidates: DiscoveryCandidate[], enabledDexes: SupportedDex[]) {
  const enabled = new Set(enabledDexes);
  const pools = [...basePools];
  for (const candidate of candidates) {
    if (!enabled.has(candidate.dex)) continue;
    if (pools.some((pool) => pool.address === candidate.pool.address)) continue;
    pools.push(candidate.pool);
  }
  return pools;
}

function resolveDiscoverySettingsPath(storageDir?: string) {
  return path.join(resolveDiscoveryDir(storageDir), "discovery-settings.json");
}

function resolveDiscoveryCandidatesPath(storageDir?: string) {
  return path.join(resolveDiscoveryDir(storageDir), "discovery-candidates.jsonl");
}

function resolveDiscoveryDir(storageDir?: string) {
  const fallback = path.resolve(process.cwd(), ".bot-data", "trading-bot");
  return storageDir?.trim() ? path.resolve(storageDir) : fallback;
}

async function ensureDir(filePath: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
}
