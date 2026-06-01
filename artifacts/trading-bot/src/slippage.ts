import type { PoolSnapshot, TradeAction } from "./domain.js";

export function recommendDynamicSlippageBps(
  pool: PoolSnapshot,
  action: TradeAction,
  suggestedBps: number,
  amountUsd: number,
  maxSlippageBps: number,
) {
  const base = Number.isFinite(suggestedBps) && suggestedBps > 0 ? suggestedBps : 50;
  const liquidityRatio = amountUsd > 0 && pool.tvlUsd > 0 ? amountUsd / pool.tvlUsd : 0;
  const volumeRatio = pool.tvlUsd > 0 ? pool.volume24hUsd / pool.tvlUsd : 0;
  const depthPenalty = liquidityRatio > 0.05 ? 28 : liquidityRatio > 0.02 ? 18 : liquidityRatio > 0.01 ? 10 : 0;
  const depthBonus = pool.tvlUsd > 5_000_000 ? -15 : pool.tvlUsd > 1_000_000 ? -8 : 0;
  const activityBonus = volumeRatio > 2 ? -8 : volumeRatio > 1 ? -5 : volumeRatio > 0.5 ? -2 : 4;
  const actionBias =
    action === "REMOVE_LIQUIDITY" ? -5 :
    action === "ADD_LIQUIDITY" ? 6 :
    action === "REBALANCE" ? 8 :
    action === "SWAP" ? 4 :
    0;

  const computed = Math.round(base + depthPenalty + activityBonus + depthBonus + actionBias);
  return clamp(computed, 10, maxSlippageBps);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
