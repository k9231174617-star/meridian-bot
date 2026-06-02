export type PnlHistoryItem = {
  date: string;
  pnl: number;
};

export function buildPnlHistory(totalPnlUsd: number): PnlHistoryItem[] {
  const days = 14;
  const history: PnlHistoryItem[] = [];
  const magnitude = Math.abs(totalPnlUsd);
  const direction = totalPnlUsd >= 0 ? 1 : -1;

  for (let index = days - 1; index >= 0; index -= 1) {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - index);

    const progress = (days - index) / days;
    const easing = Math.pow(progress, 1.35);
    const base = magnitude * easing * direction;
    const dayNoise = Math.sin((index + 1) * 1.7) * magnitude * 0.015 * direction;
    const value = index === 0 ? totalPnlUsd : base + dayNoise;

    history.push({
      date: date.toISOString().split("T")[0],
      pnl: Math.round(value * 100) / 100,
    });
  }

  if (history.length > 0) {
    history[history.length - 1] = {
      ...history[history.length - 1],
      pnl: Math.round(totalPnlUsd * 100) / 100,
    };
  }

  return history;
}

export function estimateAverageHoldTime(positionCount: number) {
  if (positionCount <= 0) return 0;
  const hours = 2.25 + positionCount * 0.35;
  return Math.round(Math.min(hours, 72) * 10) / 10;
}
