import type { Pool, PoolIlRisk, PoolSignalType } from "@workspace/api-zod";

type MeteoraPool = {
  address?: string;
  name?: string;
  mint_x?: string;
  mint_y?: string;
  liquidity?: string;
  trade_volume_24h?: string;
  fees_24h?: string;
  bin_step?: string;
  current_price?: string;
  active_id?: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function stableHash(input: string) {
  let hash = 2166136261;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function tokenFromName(name: string, fallback: string) {
  return name.split("-")[0]?.trim() || fallback;
}

function pairTokenFromName(name: string, fallback: string) {
  return name.split("-")[1]?.trim() || fallback;
}

export function computeJupScore(
  tvl: number,
  volume24h: number,
  feeRate: number,
  binStep: number,
): number {
  let score = 0;

  if (tvl > 5_000_000) score += 30;
  else if (tvl > 1_000_000) score += 20;
  else if (tvl > 500_000) score += 10;

  const volRatio = tvl > 0 ? volume24h / tvl : 0;
  if (volRatio > 2) score += 30;
  else if (volRatio > 1) score += 20;
  else if (volRatio > 0.5) score += 10;

  if (feeRate > 3) score += 20;
  else if (feeRate > 1) score += 10;

  if (binStep <= 5) score += 20;
  else if (binStep <= 20) score += 10;

  return Math.min(100, score);
}

export function computeSmartMoneyScore(
  tvl: number,
  volume24h: number,
  feeRate: number,
): number {
  const volRatio = tvl > 0 ? volume24h / tvl : 0;
  const efficiency = feeRate * 6;

  let score = 24;
  if (tvl > 2_000_000) score += 28;
  else if (tvl > 500_000) score += 20;
  else if (tvl > 250_000) score += 12;

  if (volRatio > 1.8) score += 28;
  else if (volRatio > 1) score += 20;
  else if (volRatio > 0.5) score += 12;

  score += clamp(Math.round(efficiency), 0, 12);

  return Math.min(100, score);
}

export function computeIlRisk(
  binStep: number,
  tokenX: string,
): PoolIlRisk {
  const stable = ["USDC", "USDT", "USDH", "PAI", "UXD"].some((entry) =>
    tokenX.toUpperCase().includes(entry),
  );

  if (stable) return "LOW";
  if (binStep <= 5) return "LOW";
  if (binStep <= 25) return "MEDIUM";
  return "HIGH";
}

export function enrichPool(pool: MeteoraPool): Pool {
  const tvl = Number.parseFloat(pool.liquidity || "0");
  const volume24h = Number.parseFloat(pool.trade_volume_24h || "0");
  const fee24h = Number.parseFloat(pool.fees_24h || "0");
  const binStep = Number.parseInt(pool.bin_step || "1", 10);
  const name = pool.name || `${pool.mint_x?.slice(0, 4)}/${pool.mint_y?.slice(0, 4)}`;
  const tokenX = tokenFromName(pool.name || "", "TOKEN");
  const tokenY = pairTokenFromName(pool.name || "", "USDC");
  const jupScore = computeJupScore(tvl, volume24h, tvl > 0 ? (fee24h / tvl) * 100 : 0, binStep);
  const smartMoneyScore = computeSmartMoneyScore(
    tvl,
    volume24h,
    tvl > 0 ? (fee24h / tvl) * 100 : 0,
  );
  const ilRisk = computeIlRisk(binStep, tokenX);
  const signalScore = Math.round(
    clamp(jupScore * 0.5 + smartMoneyScore * 0.3 + (tvl > 0 ? (fee24h / tvl) * 100 : 0) * 2, 0, 100),
  );
  const signalType: PoolSignalType =
    signalScore >= 65 ? "ENTER" : signalScore >= 45 ? "WATCH" : "AVOID";

  return {
    address: pool.address || "",
    name: pool.name || name,
    tokenX,
    tokenY,
    tvl,
    volume24h,
    fee24h,
    feeRate: Math.round((tvl > 0 ? (fee24h / tvl) * 100 : 0) * 100) / 100,
    binStep,
    signalScore,
    jupScore: Math.round(jupScore),
    smartMoneyScore: Math.round(smartMoneyScore),
    ilRisk,
    signalType,
    currentPrice: Number.parseFloat(pool.current_price || "0"),
    activeBinId: Number.parseInt(pool.active_id || "0", 10),
  };
}

export function poolCacheKey(params: {
  limit: number;
  minTvl: number;
  minJupScore: number;
}) {
  return `${params.limit}:${params.minTvl}:${params.minJupScore}`;
}

export function stableScoreJitter(seed: string) {
  const hash = stableHash(seed);
  return (hash % 1000) / 1000;
}
