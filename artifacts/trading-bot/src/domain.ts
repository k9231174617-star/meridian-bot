export type BotMode = "paper" | "dry-run" | "live";
export type SignalType = "LIQUIDITY_SURGE" | "PRICE_DISLOCATION" | "FEE_MOMENTUM" | "RISK_EXIT" | "REBALANCE";
export type TradeAction = "ADD_LIQUIDITY" | "REMOVE_LIQUIDITY" | "SWAP" | "HEDGE" | "WAIT" | "REBALANCE";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type PoolSnapshot = {
  address: string;
  name: string;
  tokenX: string;
  tokenY: string;
  tokenXMint?: string;
  tokenYMint?: string;
  tokenXDecimals?: number;
  tokenYDecimals?: number;
  createdAt?: string;
  mintAuthorityRevoked?: boolean;
  freezeAuthorityRevoked?: boolean;
  liquidityLocked?: boolean;
  topHolderSharePct?: number;
  topTenHolderSharePct?: number;
  rugRiskScore?: number;
  tokenSafetyScore?: number;
  tvlUsd: number;
  volume24hUsd: number;
  fee24hUsd: number;
  feeRatePct: number;
  binStep: number;
  signalScore: number;
  jupScore: number;
  smartMoneyScore: number;
  ilRisk: RiskLevel;
  signalSeed: "ENTER" | "WATCH" | "AVOID";
  currentPrice: number;
  activeBinId: number;
};

export type PriceSnapshot = {
  symbol: string;
  price: number;
  change24h: number;
};

export type MarketSnapshot = {
  capturedAt: string;
  pools: PoolSnapshot[];
  prices: PriceSnapshot[];
};

export type Signal = {
  id: string;
  type: SignalType;
  action: TradeAction;
  poolAddress: string;
  poolName: string;
  risk: RiskLevel;
  confidence: number;
  severity: number;
  reason: string[];
  suggestedCapitalUsd: number;
  slippageBps: number;
  priorityFeeMicroLamports: number;
  impermanentLossPct?: number;
  createdAt: string;
};

export type TradeIntent = {
  id: string;
  signalId: string;
  signalType: SignalType;
  action: TradeAction;
  mode: BotMode;
  poolAddress: string;
  symbolIn?: string;
  symbolOut?: string;
  amountUsd: number;
  slippageBps: number;
  priorityFeeMicroLamports: number;
  route: "JUPITER" | "DIRECT_POOL" | "PAPER";
  createdAt: string;
};

export type StoredPosition = {
  poolAddress: string;
  positionAddress: string;
  minBinId: number;
  maxBinId: number;
  strategyType: "Spot" | "Curve" | "BidAsk";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type ExecutionResult = {
  intentId: string;
  status: "filled" | "simulated" | "rejected" | "failed";
  txSignature?: string;
  filledUsd: number;
  feesUsd: number;
  slippageUsd: number;
  reason?: string;
  executedAt: string;
};

export type RiskPolicy = {
  capitalUsd: number;
  maxPositionBps: number;
  maxExposureBps: number;
  maxSlippageBps: number;
  maxDailyLossBps: number;
  minSignalConfidence: number;
  maxConcurrentIntents: number;
  maxPriceDislocationBps: number;
  maxPoolAgeHours?: number;
  poolAllowlist: string[];
  poolDenylist: string[];
  tokenAllowlist: string[];
  tokenDenylist: string[];
  maxTopHolderSharePct?: number;
  maxTopTenHolderSharePct?: number;
  maxRugRiskScore?: number;
};

export type RiskDecision = {
  approved: boolean;
  reason: string;
  cappedAmountUsd: number;
  circuitBreakerActive: boolean;
};

export type BacktestMetrics = {
  snapshots: number;
  cycles: number;
  signals: number;
  approved: number;
  rejected: number;
  fills: number;
  executions: number;
  simulatedPnlUsd: number;
  impermanentLossUsd: number;
  winRate: number;
  maxDrawdownUsd: number;
};

export type RetryJob = {
  id: string;
  intent: TradeIntent;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "dead-letter" | "done";
};
