export function calculateImpermanentLossPct(entryPrice: number, exitPrice: number) {
  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || entryPrice <= 0 || exitPrice <= 0) {
    return 0;
  }

  const ratio = exitPrice / entryPrice;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return 2 * Math.sqrt(ratio) / (1 + ratio) - 1;
}

export function calculateImpermanentLossUsd(principalUsd: number, entryPrice: number, exitPrice: number) {
  if (!Number.isFinite(principalUsd) || principalUsd <= 0) return 0;
  return Math.abs(calculateImpermanentLossPct(entryPrice, exitPrice)) * principalUsd;
}

export function calculateRoundTripLossBps(entryUsd: number, exitUsd: number) {
  if (!Number.isFinite(entryUsd) || !Number.isFinite(exitUsd) || entryUsd <= 0 || exitUsd <= 0) return 10_000;
  return Math.round((1 - (exitUsd / entryUsd)) * 10_000);
}
