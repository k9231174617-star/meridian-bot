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

    return fallbackPools(this.limit);
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
  const rugRiskScore = toOptionalNumber(record.rug_risk_score ?? record.rugRiskScore ?? record.risk_score);
  const tokenSafetyScore = toOptionalNumber(record.token_safety_score ?? record.tokenSafetyScore ?? record.safety_score);
  const jupScore = computeJupScore(tvlUsd, volume24hUsd, feeRatePct, binStep);
  const smartMoneyScore = computeSmartMoneyScore(tvlUsd, volume24hUsd, feeRatePct);
  const signalScore = Math.round(jupScore * 0.5 + smartMoneyScore * 0.3 + feeRatePct * 2);
  const signalSeed = computeSignalSeed(signalScore);

  return {
    address: toString(record.address),
    name,
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

function fallbackPools(limit: number): PoolSnapshot[] {
  const pools: PoolSnapshot[] = [
    {
      address: "synthetic-sol-usdc",
      name: "SOL-USDC",
      tokenX: "SOL",
      tokenY: "USDC",
      tokenXMint: TOKEN_MINTS.SOL,
      tokenYMint: TOKEN_MINTS.USDC,
      tokenXDecimals: TOKEN_DECIMALS.SOL,
      tokenYDecimals: TOKEN_DECIMALS.USDC,
      createdAt: new Date("2024-01-01T00:00:00.000Z").toISOString(),
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      liquidityLocked: true,
      tvlUsd: 2_500_000,
      volume24hUsd: 4_800_000,
      fee24hUsd: 18_500,
      feeRatePct: round2((18_500 / 2_500_000) * 100),
      binStep: 4,
      signalScore: 88,
      jupScore: 92,
      smartMoneyScore: 84,
      ilRisk: "LOW",
      signalSeed: "ENTER",
      currentPrice: 170,
      activeBinId: 120,
    },
    {
      address: "synthetic-jup-usdc",
      name: "JUP-USDC",
      tokenX: "JUP",
      tokenY: "USDC",
      tokenXMint: TOKEN_MINTS.JUP,
      tokenYMint: TOKEN_MINTS.USDC,
      tokenXDecimals: TOKEN_DECIMALS.JUP,
      tokenYDecimals: TOKEN_DECIMALS.USDC,
      createdAt: new Date("2024-01-15T00:00:00.000Z").toISOString(),
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      liquidityLocked: true,
      tvlUsd: 1_100_000,
      volume24hUsd: 1_900_000,
      fee24hUsd: 8_100,
      feeRatePct: round2((8_100 / 1_100_000) * 100),
      binStep: 12,
      signalScore: 72,
      jupScore: 78,
      smartMoneyScore: 68,
      ilRisk: "MEDIUM",
      signalSeed: "WATCH",
      currentPrice: 0.95,
      activeBinId: 54,
    },
    {
      address: "synthetic-bonk-usdc",
      name: "BONK-USDC",
      tokenX: "BONK",
      tokenY: "USDC",
      tokenXMint: TOKEN_MINTS.BONK,
      tokenYMint: TOKEN_MINTS.USDC,
      tokenXDecimals: TOKEN_DECIMALS.BONK,
      tokenYDecimals: TOKEN_DECIMALS.USDC,
      createdAt: new Date("2024-03-01T00:00:00.000Z").toISOString(),
      mintAuthorityRevoked: false,
      freezeAuthorityRevoked: false,
      liquidityLocked: false,
      tvlUsd: 380_000,
      volume24hUsd: 520_000,
      fee24hUsd: 2_600,
      feeRatePct: round2((2_600 / 380_000) * 100),
      binStep: 80,
      signalScore: 31,
      jupScore: 28,
      smartMoneyScore: 35,
      ilRisk: "HIGH",
      signalSeed: "AVOID",
      currentPrice: 0.000012,
      activeBinId: 11,
    },
    {
      address: "synthetic-ray-usdc",
      name: "RAY-USDC",
      tokenX: "RAY",
      tokenY: "USDC",
      tokenXMint: TOKEN_MINTS.RAY,
      tokenYMint: TOKEN_MINTS.USDC,
      tokenXDecimals: TOKEN_DECIMALS.RAY,
      tokenYDecimals: TOKEN_DECIMALS.USDC,
      createdAt: new Date("2024-02-01T00:00:00.000Z").toISOString(),
      mintAuthorityRevoked: true,
      freezeAuthorityRevoked: true,
      liquidityLocked: true,
      tvlUsd: 690_000,
      volume24hUsd: 1_250_000,
      fee24hUsd: 6_900,
      feeRatePct: round2((6_900 / 690_000) * 100),
      binStep: 24,
      signalScore: 61,
      jupScore: 66,
      smartMoneyScore: 59,
      ilRisk: "MEDIUM",
      signalSeed: "WATCH",
      currentPrice: 3.6,
      activeBinId: 33,
    },
    {
      address: "synthetic-meme-usdc",
      name: "MEME-USDC",
      tokenX: "MEME",
      tokenY: "USDC",
      tokenXMint: "MEME",
      tokenYMint: TOKEN_MINTS.USDC,
      tokenXDecimals: 6,
      tokenYDecimals: TOKEN_DECIMALS.USDC,
      createdAt: new Date("2024-03-15T00:00:00.000Z").toISOString(),
      mintAuthorityRevoked: false,
      freezeAuthorityRevoked: false,
      liquidityLocked: false,
      tvlUsd: 55_000,
      volume24hUsd: 5_000,
      fee24hUsd: 120,
      feeRatePct: round2((120 / 55_000) * 100),
      binStep: 120,
      signalScore: 22,
      jupScore: 18,
      smartMoneyScore: 25,
      ilRisk: "HIGH",
      signalSeed: "AVOID",
      currentPrice: 0.015,
      activeBinId: 5,
    },
  ];

  return pools.slice(0, limit);
}
