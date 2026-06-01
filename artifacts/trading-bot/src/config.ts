import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { BotMode, RiskPolicy } from "./domain.js";

export type HardenedRiskPolicy = RiskPolicy & {
  maxSnapshotAgeMs: number;
  circuitBreakerFailureLimit: number;
  circuitBreakerCooldownMs: number;
  requireVerifiedPoolMetadata: boolean;
};

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOT_MODE: z.enum(["paper", "dry-run", "live"]).default("paper"),
  BOT_PROVIDER: z.enum(["direct", "local-api"]).default("direct"),
  BOT_MARKET_DATA_BASE_URL: z.string().default("http://127.0.0.1:8081/api"),
  BOT_INTERVAL_MS: z.coerce.number().int().min(1000).default(15_000),
  BOT_MAX_CYCLES: optionalPositiveInteger(),
  BOT_PAPER_MAX_CYCLES: optionalPositiveInteger(),
  BOT_CAPITAL_USD: z.coerce.number().positive().default(10_000),
  BOT_MAX_POSITION_BPS: z.coerce.number().int().positive().max(10_000).default(500),
  BOT_MAX_EXPOSURE_BPS: z.coerce.number().int().positive().max(10_000).default(2000),
  BOT_MAX_SLIPPAGE_BPS: z.coerce.number().int().positive().max(5000).default(75),
  BOT_MAX_DAILY_LOSS_BPS: z.coerce.number().int().positive().max(10_000).default(300),
  BOT_MIN_SIGNAL_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.6),
  BOT_MAX_CONCURRENT_INTENTS: z.coerce.number().int().positive().default(3),
  BOT_MAX_POOL_AGE_HOURS: optionalPositiveInteger(),
  BOT_MAX_PRICE_DISLOCATION_BPS: z.coerce.number().int().positive().max(100_000).default(750),
  BOT_MARKET_DATA_MAX_AGE_MS: z.coerce.number().int().positive().default(120_000),
  BOT_CIRCUIT_BREAKER_FAILURES: z.coerce.number().int().positive().default(3),
  BOT_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(15 * 60_000),
  BOT_REQUIRE_VERIFIED_POOL_METADATA: booleanFromEnv().default(false),
  BOT_ALLOWED_POOL_ADDRESSES: z.string().default(""),
  BOT_DENIED_POOL_ADDRESSES: z.string().default(""),
  BOT_ALLOWED_TOKENS: z.string().default(""),
  BOT_DENIED_TOKENS: z.string().default(""),
  BOT_RPC_URL: z.string().optional(),
  BOT_SIGNER_SECRET_KEY: z.string().optional(),
  BOT_SIGNER_SECRET_KEY_FILE: z.string().optional(),
  BOT_SIGNER_SECRET_REMOTE_URL: z.string().optional(),
  BOT_SIGNER_SECRET_REMOTE_TOKEN: z.string().optional(),
  BOT_WALLET_ADDRESS: z.string().optional(),
  BOT_JUPITER_API_KEY: z.string().optional(),
  BOT_ALERT_WEBHOOK_URL: z.string().optional(),
  BOT_STORAGE_DIR: z.string().optional(),
  BOT_BACKTEST_SNAPSHOTS_FILE: z.string().optional(),
  DATABASE_URL: z.string().optional(),
});

function booleanFromEnv() {
  return z.preprocess((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on"].includes(normalized)) return true;
      if (["false", "0", "no", "off"].includes(normalized)) return false;
    }
    return value;
  }, z.boolean());
}

function optionalPositiveInteger() {
  return z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string" && value.trim() === "") return undefined;
    return value;
  }, z.coerce.number().int().positive().optional());
}

export type BotConfig = {
  mode: BotMode;
  provider: "direct" | "local-api";
  marketDataBaseUrl: string;
  intervalMs: number;
  maxCycles?: number;
  paperMaxCycles?: number;
  risk: HardenedRiskPolicy;
  rpcUrl?: string;
  signerSecretKey?: string;
  signerSecretKeyFile?: string;
  signerSecretRemoteUrl?: string;
  signerSecretRemoteToken?: string;
  walletAddress?: string;
  jupiterApiKey?: string;
  alertWebhookUrl?: string;
  storageDir?: string;
  backtestSnapshotsFile?: string;
  databaseUrl?: string;
};

export function loadConfig(env = process.env): BotConfig {
  const parsed = configSchema.parse(env);

  const allowedPools = parseCsvList(parsed.BOT_ALLOWED_POOL_ADDRESSES);
  const deniedPools = parseCsvList(parsed.BOT_DENIED_POOL_ADDRESSES);
  const allowedTokens = parseCsvList(parsed.BOT_ALLOWED_TOKENS);
  const deniedTokens = parseCsvList(parsed.BOT_DENIED_TOKENS);
  const risk: HardenedRiskPolicy = {
    capitalUsd: parsed.BOT_CAPITAL_USD,
    maxPositionBps: parsed.BOT_MAX_POSITION_BPS,
    maxExposureBps: parsed.BOT_MAX_EXPOSURE_BPS,
    maxSlippageBps: parsed.BOT_MAX_SLIPPAGE_BPS,
    maxDailyLossBps: parsed.BOT_MAX_DAILY_LOSS_BPS,
    minSignalConfidence: parsed.BOT_MIN_SIGNAL_CONFIDENCE,
    maxConcurrentIntents: parsed.BOT_MAX_CONCURRENT_INTENTS,
    maxPoolAgeHours: parsed.BOT_MAX_POOL_AGE_HOURS,
    maxPriceDislocationBps: parsed.BOT_MAX_PRICE_DISLOCATION_BPS,
    poolAllowlist: allowedPools,
    poolDenylist: deniedPools,
    tokenAllowlist: allowedTokens,
    tokenDenylist: deniedTokens,
    maxSnapshotAgeMs: parsed.BOT_MARKET_DATA_MAX_AGE_MS,
    circuitBreakerFailureLimit: parsed.BOT_CIRCUIT_BREAKER_FAILURES,
    circuitBreakerCooldownMs: parsed.BOT_CIRCUIT_BREAKER_COOLDOWN_MS,
    requireVerifiedPoolMetadata: parsed.BOT_REQUIRE_VERIFIED_POOL_METADATA,
  };

  return {
    mode: parsed.BOT_MODE,
    provider: parsed.BOT_PROVIDER,
    marketDataBaseUrl: parsed.BOT_MARKET_DATA_BASE_URL,
    intervalMs: parsed.BOT_INTERVAL_MS,
    maxCycles: parsed.BOT_MAX_CYCLES,
    paperMaxCycles: parsed.BOT_PAPER_MAX_CYCLES,
    rpcUrl: parsed.BOT_RPC_URL,
    signerSecretKey: parsed.BOT_SIGNER_SECRET_KEY,
    signerSecretKeyFile: parsed.BOT_SIGNER_SECRET_KEY_FILE,
    signerSecretRemoteUrl: parsed.BOT_SIGNER_SECRET_REMOTE_URL,
    signerSecretRemoteToken: parsed.BOT_SIGNER_SECRET_REMOTE_TOKEN,
    walletAddress: parsed.BOT_WALLET_ADDRESS,
    jupiterApiKey: parsed.BOT_JUPITER_API_KEY,
    alertWebhookUrl: parsed.BOT_ALERT_WEBHOOK_URL,
    storageDir: parsed.BOT_STORAGE_DIR,
    backtestSnapshotsFile: parsed.BOT_BACKTEST_SNAPSHOTS_FILE,
    databaseUrl: parsed.DATABASE_URL,
    risk,
  };
}

export async function resolveSignerSecretKey(config: BotConfig): Promise<string | undefined> {
  const directSecret = config.signerSecretKey?.trim();
  if (directSecret) return directSecret;

  const remoteSecret = config.signerSecretRemoteUrl?.trim();
  if (remoteSecret) {
    const response = await fetch(remoteSecret, {
      headers: config.signerSecretRemoteToken ? { authorization: `Bearer ${config.signerSecretRemoteToken}` } : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Secret endpoint returned ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as Record<string, unknown>;
      const candidate = payload.secretKey ?? payload.value ?? payload.key ?? payload.secret;
      return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
    }

    const text = await response.text();
    return text.trim() || undefined;
  }

  const secretFile = config.signerSecretKeyFile?.trim();
  if (!secretFile) return undefined;

  const fileContents = await readFile(secretFile, "utf8");
  const trimmed = fileContents.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function parseCsvList(value: string | undefined): string[] {
  if (!value) return [];

  return [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))];
}
