import { z } from "zod";
import { readFile } from "node:fs/promises";
import type { BotMode, RiskPolicy, SupportedDex } from "./domain.js";

export type HardenedRiskPolicy = RiskPolicy & {
  maxSnapshotAgeMs: number;
  circuitBreakerFailureLimit: number;
  circuitBreakerCooldownMs: number;
  requireVerifiedPoolMetadata: boolean;
  maxTopHolderSharePct: number;
  maxTopTenHolderSharePct: number;
  maxRugRiskScore: number;
  minDegenScore: number;
  minSocialVelocityScore: number;
  maxPreviousRugsByDev: number;
  maxWhalePressureScore: number;
  splitPositionCount: number;
};

const configSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOT_MODE: z.enum(["paper", "dry-run", "live"]).default("paper"),
  BOT_PROVIDER: z.enum(["direct", "local-api"]).default("direct"),
  BOT_ENABLED_DEXES: z.string().default("meteora,raydium,orca"),
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
  BOT_MAX_TOP_HOLDER_SHARE_PCT: z.coerce.number().min(0).max(100).default(80),
  BOT_MAX_TOP_TEN_HOLDER_SHARE_PCT: z.coerce.number().min(0).max(100).default(95),
  BOT_MAX_RUG_RISK_SCORE: z.coerce.number().int().min(0).max(100).default(70),
  BOT_MIN_DEGEN_SCORE: z.coerce.number().min(0).max(100).default(30),
  BOT_MIN_SOCIAL_VELOCITY_SCORE: z.coerce.number().min(0).max(100).default(55),
  BOT_MAX_PREVIOUS_RUGS_BY_DEV: z.coerce.number().int().min(0).default(3),
  BOT_MAX_WHALE_PRESSURE_SCORE: z.coerce.number().min(0).max(100).default(70),
  BOT_SPLIT_POSITION_COUNT: z.coerce.number().int().min(1).max(20).default(8),
  BOT_CIRCUIT_BREAKER_FAILURES: z.coerce.number().int().positive().default(3),
  BOT_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().positive().default(15 * 60_000),
  BOT_USE_JITO: booleanFromEnv().default(false),
  BOT_JITO_BLOCK_ENGINE_URL: z.string().default("https://mainnet.block-engine.jito.wtf/api/v1"),
  BOT_JITO_TIP_LAMPORTS: z.coerce.number().int().nonnegative().default(1_000),
  BOT_JITO_DONT_FRONT_TAG: z.string().default("jitodontfront111111111111111111111111111111"),
  BOT_ENABLE_HONEYPOT_SIMULATION: booleanFromEnv().default(true),
  BOT_MAX_HONEYPOT_LOSS_BPS: z.coerce.number().int().positive().max(10_000).default(150),
  BOT_ENABLE_ANTI_SCAM: booleanFromEnv().default(true),
  BOT_RUGCHECK_API_URL: z.string().optional(),
  BOT_RUGCHECK_API_KEY: z.string().optional(),
  BOT_MEME_SOCIAL_API_URL: z.string().optional(),
  BOT_MEME_EVENT_API_URL: z.string().optional(),
  BOT_ENABLE_RETRY_QUEUE: booleanFromEnv().default(true),
  BOT_RETRY_MAX_ATTEMPTS: z.coerce.number().int().positive().default(3),
  BOT_RETRY_BACKOFF_MS: z.string().default("1000,3000,10000"),
  BOT_PAPER_DEBUG_FORCE_SIGNAL: booleanFromEnv().default(false),
  BOT_PAPER_DEBUG_BYPASS_RISK: booleanFromEnv().default(false),
  BOT_REQUIRE_VERIFIED_POOL_METADATA: booleanFromEnv().default(false),
  BOT_ALLOWED_POOL_ADDRESSES: z.string().default(""),
  BOT_DENIED_POOL_ADDRESSES: z.string().default(""),
  BOT_ALLOWED_TOKENS: z.string().default(""),
  BOT_DENIED_TOKENS: z.string().default(""),
  BOT_RPC_URL: z.string().optional(),
  BOT_RPC_WS_URL: z.string().optional(),
  RPC_URL: z.string().optional(),
  WS_URL: z.string().optional(),
  YELLOWSTONE_ENDPOINT: z.string().optional(),
  YELLOWSTONE_TOKEN: z.string().optional(),
  rpc_url: z.string().optional(),
  ws_url: z.string().optional(),
  yellowstone_endpoint: z.string().optional(),
  yellowstone_token: z.string().optional(),
  BOT_SIGNER_SECRET_KEY: z.string().optional(),
  BOT_SIGNER_SECRET_KEY_FILE: z.string().optional(),
  BOT_SIGNER_SECRET_REMOTE_URL: z.string().optional(),
  BOT_SIGNER_SECRET_REMOTE_TOKEN: z.string().optional(),
  BOT_WALLET_ADDRESS: z.string().optional(),
  BOT_JUPITER_API_KEY: z.string().optional(),
  BOT_ALERT_WEBHOOK_URL: z.string().optional(),
  BOT_STORAGE_DIR: z.string().optional(),
  BOT_BACKTEST_SNAPSHOTS_FILE: z.string().optional(),
  BOT_ENABLE_WSS_POOL_WATCHER: booleanFromEnv().default(false),
  BOT_WSS_LOG_KEYWORDS: z.string().default("initialize,create_pool,create,lb_pair,whirlpool,raydium,meteora,open_position"),
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
  enabledDexes: SupportedDex[];
  marketDataBaseUrl: string;
  intervalMs: number;
  maxCycles?: number;
  paperMaxCycles?: number;
  paperDebugForceSignal: boolean;
  paperDebugBypassRisk: boolean;
  useJito: boolean;
  jitoBlockEngineUrl: string;
  jitoTipLamports: number;
  jitoDontFrontTag: string;
  enableHoneypotSimulation: boolean;
  maxHoneypotLossBps: number;
  enableAntiScam: boolean;
  rugcheckApiUrl?: string;
  rugcheckApiKey?: string;
  enableRetryQueue: boolean;
  retryMaxAttempts: number;
  retryBackoffMs: number[];
  risk: HardenedRiskPolicy;
  meme: {
    socialApiUrl?: string;
    eventApiUrl?: string;
    minDegenScore: number;
    minSocialVelocityScore: number;
    maxPreviousRugsByDev: number;
    maxWhalePressureScore: number;
    splitPositionCount: number;
  };
  rpcUrl?: string;
  rpcWsUrl?: string;
  yellowstoneEndpoint?: string;
  yellowstoneToken?: string;
  signerSecretKey?: string;
  signerSecretKeyFile?: string;
  signerSecretRemoteUrl?: string;
  signerSecretRemoteToken?: string;
  walletAddress?: string;
  jupiterApiKey?: string;
  alertWebhookUrl?: string;
  storageDir?: string;
  backtestSnapshotsFile?: string;
  enableWssPoolWatcher: boolean;
  wssLogKeywords: string[];
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
    maxTopHolderSharePct: parsed.BOT_MAX_TOP_HOLDER_SHARE_PCT,
    maxTopTenHolderSharePct: parsed.BOT_MAX_TOP_TEN_HOLDER_SHARE_PCT,
    maxRugRiskScore: parsed.BOT_MAX_RUG_RISK_SCORE,
    minDegenScore: parsed.BOT_MIN_DEGEN_SCORE,
    minSocialVelocityScore: parsed.BOT_MIN_SOCIAL_VELOCITY_SCORE,
    maxPreviousRugsByDev: parsed.BOT_MAX_PREVIOUS_RUGS_BY_DEV,
    maxWhalePressureScore: parsed.BOT_MAX_WHALE_PRESSURE_SCORE,
    splitPositionCount: parsed.BOT_SPLIT_POSITION_COUNT,
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
    enabledDexes: parseDexList(parsed.BOT_ENABLED_DEXES),
    marketDataBaseUrl: parsed.BOT_MARKET_DATA_BASE_URL,
    intervalMs: parsed.BOT_INTERVAL_MS,
    maxCycles: parsed.BOT_MAX_CYCLES,
    paperMaxCycles: parsed.BOT_PAPER_MAX_CYCLES,
    paperDebugForceSignal: parsed.BOT_PAPER_DEBUG_FORCE_SIGNAL,
    paperDebugBypassRisk: parsed.BOT_PAPER_DEBUG_BYPASS_RISK,
    useJito: parsed.BOT_USE_JITO,
    jitoBlockEngineUrl: parsed.BOT_JITO_BLOCK_ENGINE_URL,
    jitoTipLamports: parsed.BOT_JITO_TIP_LAMPORTS,
    jitoDontFrontTag: parsed.BOT_JITO_DONT_FRONT_TAG,
    enableHoneypotSimulation: parsed.BOT_ENABLE_HONEYPOT_SIMULATION,
    maxHoneypotLossBps: parsed.BOT_MAX_HONEYPOT_LOSS_BPS,
    enableAntiScam: parsed.BOT_ENABLE_ANTI_SCAM,
    rugcheckApiUrl: parsed.BOT_RUGCHECK_API_URL,
    rugcheckApiKey: parsed.BOT_RUGCHECK_API_KEY,
    meme: {
      socialApiUrl: parsed.BOT_MEME_SOCIAL_API_URL,
      eventApiUrl: parsed.BOT_MEME_EVENT_API_URL,
      minDegenScore: parsed.BOT_MIN_DEGEN_SCORE,
      minSocialVelocityScore: parsed.BOT_MIN_SOCIAL_VELOCITY_SCORE,
      maxPreviousRugsByDev: parsed.BOT_MAX_PREVIOUS_RUGS_BY_DEV,
      maxWhalePressureScore: parsed.BOT_MAX_WHALE_PRESSURE_SCORE,
      splitPositionCount: parsed.BOT_SPLIT_POSITION_COUNT,
    },
    enableRetryQueue: parsed.BOT_ENABLE_RETRY_QUEUE,
    retryMaxAttempts: parsed.BOT_RETRY_MAX_ATTEMPTS,
    retryBackoffMs: parseCsvList(parsed.BOT_RETRY_BACKOFF_MS)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0),
    rpcUrl: parsed.BOT_RPC_URL ?? parsed.RPC_URL ?? parsed.rpc_url,
    rpcWsUrl: parsed.BOT_RPC_WS_URL ?? parsed.WS_URL ?? parsed.ws_url,
    yellowstoneEndpoint: parsed.YELLOWSTONE_ENDPOINT ?? parsed.yellowstone_endpoint,
    yellowstoneToken: parsed.YELLOWSTONE_TOKEN ?? parsed.yellowstone_token,
    signerSecretKey: parsed.BOT_SIGNER_SECRET_KEY,
    signerSecretKeyFile: parsed.BOT_SIGNER_SECRET_KEY_FILE,
    signerSecretRemoteUrl: parsed.BOT_SIGNER_SECRET_REMOTE_URL,
    signerSecretRemoteToken: parsed.BOT_SIGNER_SECRET_REMOTE_TOKEN,
    walletAddress: parsed.BOT_WALLET_ADDRESS,
    jupiterApiKey: parsed.BOT_JUPITER_API_KEY,
    alertWebhookUrl: parsed.BOT_ALERT_WEBHOOK_URL,
    storageDir: parsed.BOT_STORAGE_DIR,
    backtestSnapshotsFile: parsed.BOT_BACKTEST_SNAPSHOTS_FILE,
    enableWssPoolWatcher: parsed.BOT_ENABLE_WSS_POOL_WATCHER,
    wssLogKeywords: parseCsvList(parsed.BOT_WSS_LOG_KEYWORDS),
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

export function parseDexList(value: string | undefined): SupportedDex[] {
  const allowed: SupportedDex[] = [];
  for (const entry of parseCsvList(value).map((item) => item.toLowerCase())) {
    if (entry === "meteora" || entry === "raydium" || entry === "orca") {
      if (!allowed.includes(entry)) allowed.push(entry);
    }
  }
  return allowed.length > 0 ? allowed : ["meteora", "raydium", "orca"];
}
