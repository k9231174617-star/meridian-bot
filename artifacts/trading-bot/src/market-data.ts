import type { MarketSnapshot, PoolSnapshot, PriceSnapshot } from "./domain.js";

export type MarketDataProvider = {
  fetchSnapshot(): Promise<MarketSnapshot>;
};

const METEORA_API = "https://dlmm-api.meteora.ag";
const JUPITER_PRICE_ENDPOINTS = [
  "https://lite-api.jup.ag/price/v3",
  "https://api.jup.ag/price/v2",
];
const DEFAULT_TOKENS = ["SOL", "USDC", "JUP", "RAY", "BONK"];
const TOKEN_MINTS: Record<string, string> = {
  SOL: "So11111111111111111111111111111111111111112",
  USDC: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN",
  RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
};
const TOKEN_DECIMALS: Record<string, number> = {
  SOL: 9,
  USDC: 6,
  JUP: 6,
  RAY: 6,
  BONK: 5,
};

export class DirectMarketDataProvider implements MarketDataProvider {
  constructor(
    private readonly limit = 25,
    private readonly minTvl = 100_000,
    private readonly jupiterApiKey?: string,
  ) {}

  async fetchSnapshot(): Promise<MarketSnapshot> {
    const [pools, prices] = await Promise.all([this.fetchPools(), this.fetchPrices(DEFAULT_TOKENS)]);
    return { capturedAt: new Date().toISOString(), pools, prices };
  }

  private async fetchPools(): Promise<PoolSnapshot[]> {
    try {
      const response = await fetch(`${METEORA_API}/pair/all?limit=100&sort_key=liquidity&order_by=desc`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) throw new Error(`Meteora API error: ${response.status}`);

      const raw = (await response.json()) as unknown[];
      const pools = raw
        .filter((record) => Number((record as Record<string, unknown>).liquidity ?? 0) >= this.minTvl)
        .slice(0, this.limit)
        .map((record) => normalizePool(record as Record<string, unknown>));

      if (pools.length > 0) return pools;
    } catch {
      // Fall through to deterministic synthetic pools.
    }

    return [];
  }

  private async fetchPrices(tokens: string[]): Promise<PriceSnapshot[]> {
    const ids = tokens.map((token) => TOKEN_MINTS[token] ?? token).join(",");
    const raw = await fetchPriceMap(ids, this.jupiterApiKey);
    return tokens.map((symbol) => {
      const mint = TOKEN_MINTS[symbol] ?? symbol;
      const entry = raw[mint];
      return {
        symbol,
        price: toPriceNumber(entry),
        change24h: toChangeNumber(entry),
      };
    });
  }
}

export class LocalApiMarketDataProvider implements MarketDataProvider {
  constructor(private readonly baseUrl: string) {}

  async fetchSnapshot(): Promise<MarketSnapshot> {
    const [pools, prices] = await Promise.all([this.fetchPools(), this.fetchPrices(DEFAULT_TOKENS)]);
    return { capturedAt: new Date().toISOString(), pools, prices };
  }

  private async fetchPools(): Promise<PoolSnapshot[]> {
    const response = await fetch(`${this.baseUrl}/pools?limit=25&minTvl=100000`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Local pools API error: ${response.status}`);
    const body = (await response.json()) as { pools?: unknown[] };
    return (body.pools ?? []).map((record) => normalizePool(record as Record<string, unknown>));
  }

  private async fetchPrices(tokens: string[]): Promise<PriceSnapshot[]> {
    const response = await fetch(`${this.baseUrl}/prices?tokens=${tokens.join(",")}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`Local prices API error: ${response.status}`);
    const body = (await response.json()) as { prices?: Record<string, { price?: number; change24h?: number }> };
    return tokens.map((symbol) => ({
      symbol,
      price: Number(body.prices?.[symbol]?.price ?? 0),
      change24h: Number(body.prices?.[symbol]?.change24h ?? 0),
    }));
  }
}

function normalizePool(record: Record<string, unknown>): PoolSnapshot {
  const tvlUsd = toNumber(record.liquidity ?? record.tvl ?? record.tvlUsd);
  const volume24hUsd = toNumber(record.trade_volume_24h ?? record.volume24h ?? record.volume24hUsd);
  const fee24hUsd = toNumber(record.fees_24h ?? record.fee24h ?? record.fee24hUsd);
  const binStep = toInteger(record.bin_step ?? record.binStep, 1);
  const feeRatePct = tvlUsd > 0 ? (fee24hUsd / tvlUsd) * 100 : 0;
  const name = toString(record.name) || `${prefix(record.mint_x)}/${prefix(record.mint_y)}`;
  const [tokenX, tokenY] = splitPairName(name);
  const tokenXMint = toString(record.mint_x ?? record.token_x_mint ?? record.tokenXMint) || TOKEN_MINTS[tokenX];
  const tokenYMint = toString(record.mint_y ?? record.token_y_mint ?? record.tokenYMint) || TOKEN_MINTS[tokenY];
  const tokenXDecimals = toInteger(record.decimals_x ?? record.token_x_decimals ?? record.tokenXDecimals, fallbackDecimals(tokenX));
  const tokenYDecimals = toInteger(record.decimals_y ?? record.token_y_decimals ?? record.tokenYDecimals, fallbackDecimals(tokenY));
  const createdAt = toTimestamp(record.created_at ?? record.createdAt ?? record.pool_created_at ?? record.launch_time);
  const mintAuthorityRevoked = toOptionalBoolean(
    record.mint_authority_revoked ?? record.mintAuthorityRevoked ?? record.mint_authority_disabled,
  );
  const freezeAuthorityRevoked = toOptionalBoolean(
    record.freeze_authority_revoked ?? record.freezeAuthorityRevoked ?? record.freeze_authority_disabled,
  );
  const liquidityLocked = toOptionalBoolean(record.liquidity_locked ?? record.liquidityLocked ?? record.lp_locked);
  const topHolderSharePct = toOptionalNumber(record.top_holder_share_pct ?? record.topHolderSharePct ?? record.top_holders_pct);
  const topTenHolderSharePct = toOptionalNumber(record.top_ten_holder_share_pct ?? record.topTenHolderSharePct ?? record.top_10_holder_share_pct);
  const rugRiskScore = toOptionalNumber(record.rug_risk_score ?? record.rugRiskScore ?? record.risk_score);
  const tokenSafetyScore = toOptionalNumber(record.token_safety_score ?? record.tokenSafetyScore ?? record.safety_score);
  const jupScore = computeJupScore(tvlUsd, volume24hUsd, feeRatePct, binStep);
  const smartMoneyScore = computeSmartMoneyScore(tvlUsd, volume24hUsd, feeRatePct);
  const holderGini = toOptionalNumber(record.holder_gini ?? record.holderGini) ?? estimateHolderGini(topHolderSharePct, topTenHolderSharePct);
  const devWalletAgeDays = toOptionalNumber(record.dev_wallet_age_days ?? record.devWalletAgeDays) ?? estimateDevWalletAgeDays(createdAt);
  const creatorAddress = toString(record.creator_address ?? record.creatorAddress ?? record.owner ?? record.creator);
  const previousRugsByDev = toInteger(record.previous_rugs_by_dev ?? record.previousRugsByDev, 0);
  const contractRiskScore = toOptionalNumber(record.contract_risk_score ?? record.contractRiskScore) ?? estimateContractRiskScore({
    mintAuthorityRevoked,
    freezeAuthorityRevoked,
    liquidityLocked,
    topTenHolderSharePct,
    previousRugsByDev,
  });
  const bondingCurveProgressPct = toOptionalNumber(record.bonding_curve_progress_pct ?? record.bondingCurveProgressPct);
  const migrateTarget = toMigrateTarget(record.migrate_target ?? record.migrateTarget);
  const socialVelocityScore = toOptionalNumber(record.social_velocity_score ?? record.socialVelocityScore) ?? estimateSocialVelocityScore({
    tvlUsd,
    volume24hUsd,
    feeRatePct,
    signalScore: Math.round(jupScore * 0.5 + smartMoneyScore * 0.3 + feeRatePct * 2),
    jupScore,
    smartMoneyScore,
  });
  const socialVelocityDelta = toOptionalNumber(record.social_velocity_delta ?? record.socialVelocityDelta);
  const whaleFlowBps = toOptionalNumber(record.whale_flow_bps ?? record.whaleFlowBps) ?? estimateWhaleFlowBps({
    topHolderSharePct,
    topTenHolderSharePct,
    volume24hUsd,
    tvlUsd,
  });
  const whalePressureScore = toOptionalNumber(record.whale_pressure_score ?? record.whalePressureScore) ?? estimateWhalePressureScore({
    whaleFlowBps,
    topTenHolderSharePct,
    rugRiskScore: rugRiskScore ?? contractRiskScore,
  });
  const eventWindowActive = toOptionalBoolean(record.event_window_active ?? record.eventWindowActive);
  const eventName = toString(record.event_name ?? record.eventName);
  const eventBlocksRemaining = toOptionalNumber(record.event_blocks_remaining ?? record.eventBlocksRemaining);
  const topHolderWallets = toStringArray(record.top_holder_wallets ?? record.topHolderWallets ?? record.holder_wallets ?? record.holderWallets);
  const mevAttackCount = toOptionalNumber(record.mev_attack_count ?? record.mevAttackCount);
  const honeypotSimulationBps = toOptionalNumber(record.honeypot_simulation_bps ?? record.honeypotSimulationBps);
  const fdvUsd = toOptionalNumber(record.fdv_usd ?? record.fdvUsd ?? record.market_cap ?? record.marketCap) ?? estimateFdv(tvlUsd, volume24hUsd);
  const degenScore = toOptionalNumber(record.degen_score ?? record.degenScore) ?? estimateDegenScore({
    tvlUsd,
    fdvUsd,
    holderGini,
    devWalletAgeDays,
    previousRugsByDev,
    contractRiskScore,
    socialVelocityScore,
    whalePressureScore,
  });
  const signalScore = Math.round(jupScore * 0.5 + smartMoneyScore * 0.3 + feeRatePct * 2);
  const signalSeed = computeSignalSeed(signalScore);

  return {
    address: toString(record.address),
    name,
    dex: toDexLabel(record.dex ?? record.protocol ?? record.source),
    tokenX,
    tokenY,
    tokenXMint,
    tokenYMint,
    tokenXDecimals,
    tokenYDecimals,
    createdAt,
    mintAuthorityRevoked,
    freezeAuthorityRevoked,
    liquidityLocked,
    topHolderSharePct,
    topTenHolderSharePct,
    holderGini: round2(holderGini),
    devWalletAgeDays: round2(devWalletAgeDays),
    creatorAddress: creatorAddress || undefined,
    previousRugsByDev,
    contractRiskScore: round2(contractRiskScore),
    bondingCurveProgressPct: bondingCurveProgressPct === undefined ? undefined : round2(bondingCurveProgressPct),
    migrateTarget,
    socialVelocityScore: round2(socialVelocityScore),
    socialVelocityDelta: socialVelocityDelta === undefined ? undefined : round2(socialVelocityDelta),
    whaleFlowBps: round2(whaleFlowBps),
    whalePressureScore: round2(whalePressureScore),
    fdvUsd: round2(fdvUsd),
    eventWindowActive,
    eventName: eventName || undefined,
    eventBlocksRemaining: eventBlocksRemaining === undefined ? undefined : Math.round(eventBlocksRemaining),
    topHolderWallets,
    mevAttackCount: mevAttackCount === undefined ? undefined : Math.max(0, Math.round(mevAttackCount)),
    honeypotSimulationBps: honeypotSimulationBps === undefined ? undefined : Math.max(0, round2(honeypotSimulationBps)),
    rugRiskScore,
    tokenSafetyScore,
    tvlUsd,
    volume24hUsd,
    fee24hUsd,
    feeRatePct: round2(feeRatePct),
    binStep,
    signalScore,
    jupScore: Math.round(jupScore),
    smartMoneyScore: Math.round(smartMoneyScore),
    ilRisk: computeIlRisk(binStep, tokenX),
    signalSeed,
    currentPrice: toNumber(record.current_price ?? record.currentPrice),
    activeBinId: toInteger(record.active_id ?? record.activeBinId, 0),
    degenScore: round2(degenScore),
  };
}

function computeJupScore(tvl: number, vol: number, feeRate: number, binStep: number): number {
  let score = 0;
  if (tvl > 5_000_000) score += 30;
  else if (tvl > 1_000_000) score += 20;
  else if (tvl > 500_000) score += 10;
  const volRatio = tvl > 0 ? vol / tvl : 0;
  if (volRatio > 2) score += 30;
  else if (volRatio > 1) score += 20;
  else if (volRatio > 0.5) score += 10;
  if (feeRate > 3) score += 20;
  else if (feeRate > 1) score += 10;
  if (binStep <= 5) score += 20;
  else if (binStep <= 20) score += 10;
  return Math.min(100, score);
}

function computeSmartMoneyScore(tvl: number, vol: number, feeRate: number): number {
  let score = 24;
  if (tvl > 2_000_000) score += 30;
  else if (tvl > 500_000) score += 18;
  const ratio = tvl > 0 ? vol / tvl : 0;
  if (ratio > 1.5) score += 24;
  else if (ratio > 0.8) score += 14;
  else if (ratio > 0.25) score += 8;
  if (feeRate > 2) score += 16;
  else if (feeRate > 0.75) score += 10;
  else if (feeRate > 0.25) score += 4;
  return Math.min(100, score);
}

function computeIlRisk(binStep: number, tokenX: string) {
  const stable = ["USDC", "USDT", "USDH", "PAI", "UXD"].some((symbol) => tokenX.toUpperCase().includes(symbol));
  if (stable || binStep <= 5) return "LOW" as const;
  if (binStep <= 25) return "MEDIUM" as const;
  return "HIGH" as const;
}

function computeSignalSeed(score: number) {
  if (score >= 65) return "ENTER" as const;
  if (score >= 45) return "WATCH" as const;
  return "AVOID" as const;
}

function splitPairName(name: string): [string, string] {
  const [tokenX = "TOKEN", tokenY = "USDC"] = name.split("-");
  return [tokenX || "TOKEN", tokenY || "USDC"];
}

function prefix(value: unknown) {
  const text = toString(value);
  return text ? text.slice(0, 4) : "TKN";
}

function toString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function fetchPriceMap(ids: string, apiKey?: string): Promise<Record<string, any>> {
  for (const endpoint of JUPITER_PRICE_ENDPOINTS) {
    try {
      const response = await fetch(`${endpoint}?ids=${ids}`, {
        headers: apiKey ? { Accept: "application/json", "x-api-key": apiKey } : { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) continue;

      const body = (await response.json()) as Record<string, any> | { data?: Record<string, any> };
      if (body && "data" in body && body.data) return body.data;
      return body as Record<string, any>;
    } catch {
      continue;
    }
  }

  return {} as Record<string, any>;
}

function toPriceNumber(entry: unknown) {
  if (!entry || typeof entry !== "object") return 0;
  const record = entry as Record<string, unknown>;
  return toNumber(record.usdPrice ?? record.price);
}

function toChangeNumber(entry: unknown) {
  if (!entry || typeof entry !== "object") return 0;
  const record = entry as Record<string, unknown>;
  return toNumber(
    record.priceChange24h ??
      record.change24h ??
      record.percentChange24h ??
      record.percent_change_24h ??
      record.price_change_24h,
  );
}

function toInteger(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toOptionalBoolean(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "1", "yes", "revoked", "locked"].includes(normalized)) return true;
    if (["false", "0", "no", "unlocked", "disabled"].includes(normalized)) return false;
  }
  return undefined;
}

function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function estimateHolderGini(topHolderSharePct?: number, topTenHolderSharePct?: number) {
  const topOne = (topHolderSharePct ?? 20) / 100;
  const topTen = (topTenHolderSharePct ?? Math.max(topHolderSharePct ?? 20, 35)) / 100;
  return clamp(topTen * 0.75 + topOne * 0.25, 0, 1);
}

function estimateDevWalletAgeDays(createdAt?: string) {
  if (!createdAt) return 7;
  const timestamp = new Date(createdAt).getTime();
  if (!Number.isFinite(timestamp)) return 7;
  return Math.max(1, Math.round((Date.now() - timestamp) / 86_400_000));
}

function estimateContractRiskScore(params: {
  mintAuthorityRevoked?: boolean;
  freezeAuthorityRevoked?: boolean;
  liquidityLocked?: boolean;
  topTenHolderSharePct?: number;
  previousRugsByDev?: number;
}) {
  let score = 0;
  if (params.mintAuthorityRevoked === false) score += 35;
  if (params.freezeAuthorityRevoked === false) score += 25;
  if (params.liquidityLocked === false) score += 15;
  if ((params.topTenHolderSharePct ?? 0) > 85) score += 15;
  if ((params.previousRugsByDev ?? 0) > 0) score += Math.min(20, (params.previousRugsByDev ?? 0) * 8);
  return clamp(score, 0, 100);
}

function estimateSocialVelocityScore(params: {
  tvlUsd: number;
  volume24hUsd: number;
  feeRatePct: number;
  signalScore: number;
  jupScore: number;
  smartMoneyScore: number;
}) {
  const activity = params.tvlUsd > 0 ? params.volume24hUsd / params.tvlUsd : 0;
  const momentum = params.feeRatePct * 4 + params.smartMoneyScore * 0.25 + params.jupScore * 0.12;
  return clamp(15 + activity * 20 + momentum + params.signalScore * 0.08, 0, 100);
}

function estimateWhaleFlowBps(params: {
  topHolderSharePct?: number;
  topTenHolderSharePct?: number;
  volume24hUsd: number;
  tvlUsd: number;
}) {
  const concentration = params.topTenHolderSharePct ?? params.topHolderSharePct ?? 40;
  const depth = params.tvlUsd > 0 ? params.volume24hUsd / params.tvlUsd : 0;
  return (concentration - 45) * 12 + depth * 180;
}

function estimateWhalePressureScore(params: {
  whaleFlowBps: number;
  topTenHolderSharePct?: number;
  rugRiskScore?: number;
}) {
  return clamp((params.topTenHolderSharePct ?? 40) * 0.45 + Math.abs(params.whaleFlowBps) / 30 + (params.rugRiskScore ?? 45) * 0.2, 0, 100);
}

function estimateFdv(tvlUsd: number, volume24hUsd: number) {
  return Math.max(10_000, tvlUsd * 7 + volume24hUsd * 0.5);
}

function estimateDegenScore(params: {
  tvlUsd: number;
  fdvUsd: number;
  holderGini: number;
  devWalletAgeDays: number;
  previousRugsByDev: number;
  contractRiskScore: number;
  socialVelocityScore: number;
  whalePressureScore: number;
}) {
  const liquidityScore = params.fdvUsd > 0 ? clamp((params.tvlUsd / params.fdvUsd) * 180, 0, 100) : 0;
  const holderScore = clamp((1 - params.holderGini) * 100, 0, 100);
  const ageScore = clamp(params.devWalletAgeDays * 1.8, 0, 100);
  const socialScore = clamp(params.socialVelocityScore, 0, 100);
  const contractScore = clamp(100 - params.contractRiskScore, 0, 100);
  const rugsPenalty = Math.min(45, params.previousRugsByDev * 12);
  const whalePenalty = Math.min(35, params.whalePressureScore * 0.35);
  const score = 8
    + liquidityScore * 0.25
    + holderScore * 0.18
    + ageScore * 0.14
    + socialScore * 0.18
    + contractScore * 0.16
    - rugsPenalty
    - whalePenalty;
  return clamp(score, 0, 100);
}

function toMigrateTarget(value: unknown): PoolSnapshot["migrateTarget"] | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === "RAYDIUM" || normalized === "ORCA" || normalized === "METEORA") {
    return normalized;
  }
  return undefined;
}

function fallbackDecimals(symbol: string) {
  return TOKEN_DECIMALS[symbol.toUpperCase()] ?? 6;
}

function toTimestamp(value: unknown) {
  const date = new Date(String(value ?? ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function toDexLabel(value: unknown) {
  const dex = toString(value).toLowerCase();
  if (dex === "meteora" || dex === "raydium" || dex === "orca") return dex;
  return undefined;
}
