import type { PoolIlRisk, PoolSignalType } from "@workspace/api-zod";

export type MeteoraPoolRecord = Record<string, unknown>;

export function enrichPool(record: MeteoraPoolRecord) {
  const tvl = toNumber(record.liquidity);
  const volume24h = toNumber(record.trade_volume_24h);
  const fee24h = toNumber(record.fees_24h);
  const feeRate = tvl > 0 ? (fee24h / tvl) * 100 : 0;
  const binStep = toInteger(record.bin_step, 1);

  const name = toString(record.name) || `${prefix(record.mint_x)}/${prefix(record.mint_y)}`;
  const [tokenX, tokenY] = splitPairName(name);

  const jupScore = computeJupScore(tvl, volume24h, feeRate, binStep);
  const smartMoneyScore = computeSmartMoneyScore(tvl, volume24h, feeRate);
  const ilRisk = computeIlRisk(binStep, tokenX);
  const signalScore = jupScore * 0.5 + smartMoneyScore * 0.3 + feeRate * 2;
  const signalType = computeSignalType(signalScore);

  return {
    address: toString(record.address),
    name,
    tokenX,
    tokenY,
    tvl,
    volume24h,
    fee24h,
    feeRate: round2(feeRate),
    binStep,
    signalScore: Math.round(signalScore),
    jupScore: Math.round(jupScore),
    smartMoneyScore: Math.round(smartMoneyScore),
    ilRisk,
    signalType,
    currentPrice: toNumber(record.current_price),
    activeBinId: toInteger(record.active_id, 0),
  };
}

export function computeJupScore(
  tvl: number,
  vol: number,
  feeRate: number,
  binStep: number,
): number {
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

export function computeSmartMoneyScore(
  tvl: number,
  vol: number,
  feeRate: number,
): number {
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

export function computeIlRisk(
  binStep: number,
  tokenX: string,
): PoolIlRisk {
  const stable = ["USDC", "USDT", "USDH", "PAI", "UXD"].some((symbol) =>
    tokenX.toUpperCase().includes(symbol),
  );

  if (stable) return "LOW";
  if (binStep <= 5) return "LOW";
  if (binStep <= 25) return "MEDIUM";
  return "HIGH";
}

export function computeSignalType(score: number): PoolSignalType {
  if (score >= 65) return "ENTER";
  if (score >= 45) return "WATCH";
  return "AVOID";
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

function toInteger(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
