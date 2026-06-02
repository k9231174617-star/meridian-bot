export const DEMO_WALLET_ADDRESS = "DeMo111111111111111111111111111111111111111";

export type DemoPositionRecord = {
  address: string;
  poolAddress: string;
  poolName: string;
  tokenX: string;
  tokenY: string;
  lowerBinId: number;
  upperBinId: number;
  activeBinId: number;
  inRange: boolean;
  liquidityUsd: number;
  tokenXAmount: number;
  tokenYAmount: number;
  feesEarned: number;
  pnlUsd: number;
  pnlPct: number;
  openedAt: string;
};

export function buildDemoPositions(): DemoPositionRecord[] {
  const now = new Date();
  const openedAtSol = new Date(now);
  openedAtSol.setHours(openedAtSol.getHours() - 46);
  const openedAtRay = new Date(now);
  openedAtRay.setHours(openedAtRay.getHours() - 5);

  return [
    {
      address: "demo-sol-usdc-pos-1",
      poolAddress: "demo-sol-usdc-pool",
      poolName: "SOL/USDC",
      tokenX: "SOL",
      tokenY: "USDC",
      lowerBinId: 48,
      upperBinId: 76,
      activeBinId: 63,
      inRange: true,
      liquidityUsd: 2550,
      tokenXAmount: 12.3,
      tokenYAmount: 2.0,
      feesEarned: 42.1,
      pnlUsd: 184.2,
      pnlPct: 7.2,
      openedAt: openedAtSol.toISOString(),
    },
    {
      address: "demo-ray-usdc-pos-2",
      poolAddress: "demo-ray-usdc-pool",
      poolName: "RAY/USDC",
      tokenX: "RAY",
      tokenY: "USDC",
      lowerBinId: 16,
      upperBinId: 34,
      activeBinId: 40,
      inRange: false,
      liquidityUsd: 1980,
      tokenXAmount: 430,
      tokenYAmount: 19,
      feesEarned: 19.3,
      pnlUsd: -22.0,
      pnlPct: -1.1,
      openedAt: openedAtRay.toISOString(),
    },
  ];
}

export function buildDemoAnalyticsSummary() {
  return {
    totalPnlUsd: 284,
    totalFeesEarned: 61.4,
    totalTrades: 14,
    winRate: 71,
    avgHoldTime: 3.2,
    pnlHistory: [
      { date: "2026-05-20", pnl: 18.2 },
      { date: "2026-05-21", pnl: 29.4 },
      { date: "2026-05-22", pnl: 37.9 },
      { date: "2026-05-23", pnl: 46.8 },
      { date: "2026-05-24", pnl: 58.6 },
      { date: "2026-05-25", pnl: 71.2 },
      { date: "2026-05-26", pnl: 84.5 },
      { date: "2026-05-27", pnl: 101.4 },
      { date: "2026-05-28", pnl: 126.9 },
      { date: "2026-05-29", pnl: 151.2 },
      { date: "2026-05-30", pnl: 173.6 },
      { date: "2026-05-31", pnl: 198.8 },
      { date: "2026-06-01", pnl: 241.1 },
      { date: "2026-06-02", pnl: 284 },
    ],
  };
}

export function buildDemoPools() {
  return [
    {
      address: "demo-sol-usdc-pool",
      name: "SOL/USDC",
      tokenX: "SOL",
      tokenY: "USDC",
      tvl: 2_400_000,
      volume24h: 18_200_000,
      fee24h: 112_800,
      feeRate: 4.7,
      binStep: 1,
      signalScore: 87,
      jupScore: 87,
      smartMoneyScore: 72,
      ilRisk: "LOW",
      signalType: "ENTER",
      currentPrice: 146.2,
      activeBinId: 63,
      dex: "meteora",
      discoverySource: "meteora-api",
      tokenSafetyScore: 94,
      rugRiskScore: 18,
      degenScore: 84,
      holderGini: 0.31,
      devWalletAgeDays: 81,
      previousRugsByDev: 0,
      contractRiskScore: 22,
      socialVelocityScore: 73,
      whalePressureScore: 28,
      eventWindowActive: false,
    },
    {
      address: "demo-ray-usdc-pool",
      name: "RAY/USDC",
      tokenX: "RAY",
      tokenY: "USDC",
      tvl: 898_000,
      volume24h: 7_600_000,
      fee24h: 27_838,
      feeRate: 3.1,
      binStep: 5,
      signalScore: 61,
      jupScore: 61,
      smartMoneyScore: 45,
      ilRisk: "MEDIUM",
      signalType: "WATCH",
      currentPrice: 2.41,
      activeBinId: 31,
      dex: "meteora",
      discoverySource: "meteora-api",
      tokenSafetyScore: 82,
      rugRiskScore: 34,
      degenScore: 62,
      holderGini: 0.48,
      devWalletAgeDays: 18,
      previousRugsByDev: 1,
      contractRiskScore: 41,
      socialVelocityScore: 49,
      whalePressureScore: 52,
      eventWindowActive: true,
      eventName: "demo_event_window",
      eventBlocksRemaining: 18,
    },
  ];
}
