export type BotMode = "paper" | "dry-run" | "live";
export type SupportedDex = "meteora" | "raydium" | "orca";
export type StrategyType =
  | "RUG_PULL_SHIELD"
  | "SNIPER_SHADOW"
  | "BONDING_CURVE_ARB"
  | "SOCIAL_VELOCITY"
  | "MEV_RESIST"
  | "INSURANCE_HEDGE"
  | "COPY_PASTE_LP"
  | "FLASH_LP"
  | "WHALE_ADJUST"
  | "TICK_RANGE_PROPHET"
  | "LIQUIDITY_VACUUM"
  | "WALLET_FINGERPRINT"
  | "FEE_COMPOUNDING_FLYWHEEL"
  | "NARRATIVE_GRAPH"
  | "DEAD_POOL_RESURRECTOR"
  | "EXECUTION_AUCTION"
  | "PHANTOM_LIQUIDITY"
  | "SMART_MONEY_SHADOW"
  | "RUG_DNA_SCANNER"
  | "CROSS_DEX_ARB"
  | "PUMPFUN_GRADUATE_PREDICTOR"
  | "LIQUIDITY_TRAP"
  | "PREDICTIVE_REBALANCE";
export type StrategyAction =
  | TradeAction
  | "WATCH"
  | "BLACKLIST"
  | "REDUCE_EXPOSURE"
  | "REPRICE"
  | "PAUSE"
  | "OPEN_POSITION";
export type SignalType =
  | "LIQUIDITY_SURGE"
  | "PRICE_DISLOCATION"
  | "FEE_MOMENTUM"
  | "RISK_EXIT"
  | "REBALANCE"
  | "RUG_SHIELD"
  | "SNIPER_SHADOW"
  | "BONDING_CURVE_ARB"
  | "SOCIAL_VELOCITY"
  | "MEV_RESIST"
  | "INSURANCE_HEDGE"
  | "COPY_PASTE_LP"
  | "FLASH_LP"
  | "WHALE_ADJUST"
  | "TICK_RANGE_PROPHET"
  | "LIQUIDITY_VACUUM"
  | "WALLET_FINGERPRINT"
  | "FEE_COMPOUNDING_FLYWHEEL"
  | "NARRATIVE_GRAPH"
  | "DEAD_POOL_RESURRECTOR"
  | "EXECUTION_AUCTION"
  | "PHANTOM_LIQUIDITY"
  | "SMART_MONEY_SHADOW"
  | "RUG_DNA_SCANNER"
  | "CROSS_DEX_ARB"
  | "PUMPFUN_GRADUATE_PREDICTOR"
  | "LIQUIDITY_TRAP"
  | "PREDICTIVE_REBALANCE";
export type TradeAction = "ADD_LIQUIDITY" | "REMOVE_LIQUIDITY" | "SWAP" | "HEDGE" | "WAIT" | "REBALANCE";
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

export type PoolSnapshot = {
  address: string;
  name: string;
  dex?: SupportedDex;
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
  degenScore?: number;
  holderGini?: number;
  devWalletAgeDays?: number;
  creatorAddress?: string;
  previousRugsByDev?: number;
  contractRiskScore?: number;
  bondingCurveProgressPct?: number;
  migrateTarget?: "RAYDIUM" | "ORCA" | "METEORA" | "UNKNOWN";
  socialVelocityScore?: number;
  socialVelocityDelta?: number;
  whaleFlowBps?: number;
  whalePressureScore?: number;
  fdvUsd?: number;
  eventWindowActive?: boolean;
  eventName?: string;
  eventBlocksRemaining?: number;
  topHolderWallets?: string[];
  mevAttackCount?: number;
  honeypotSimulationBps?: number;
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
  discoveryConfidence?: number;
  discoverySource?: "meteora-api" | "wss-log" | "wss-program" | "rpc-recent" | "rpc-account" | "geckoterminal-api" | "fallback";
  discoverySignature?: string;
  isDiscoveryCandidate?: boolean;
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
  degenScore?: number;
  socialVelocityScore?: number;
  whalePressureScore?: number;
  eventName?: string;
  executionHints?: {
    splitCount?: number;
    minDelayMs?: number;
    maxDelayMs?: number;
    priorityProtection?: "HIGH" | "MAX";
    hedgeTo?: string;
    tickRange?: {
      lowerBinId: number;
      upperBinId: number;
      centerBinId: number;
      horizonMinutes: number;
      confidence: number;
      predictedMoveBps: number;
      tokenProfile?: {
        category: "memecoin" | "stable" | "bluechip" | "unknown";
        confidence: number;
        downsideMultiplier: number;
        upsideMultiplier: number;
        tailMultiplier: number;
      };
    };
    relatedPools?: string[];
    compoundingRatio?: number;
    routeAuction?: {
      preferredRoute: "JUPITER" | "DIRECT_POOL" | "JITO";
      candidates: Array<"JUPITER" | "DIRECT_POOL" | "JITO">;
      simulationBudgetMs: number;
    };
    fingerprintRisk?: number;
    phantomLiquidity?: boolean;
  };
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
  route: "JUPITER" | "DIRECT_POOL" | "PAPER" | "AUCTION";
  executionHints?: Signal["executionHints"];
  createdAt: string;
};

export type StrategyDirective = {
  id: string;
  sourceEventType: string;
  strategy: StrategyType;
  action: StrategyAction;
  poolAddress?: string;
  tokenMint?: string;
  walletAddress?: string;
  confidence: number;
  reasons: string[];
  executionHints?: Signal["executionHints"];
  createdAt: string;
};

export type OrchestrationEventHistory = {
  id: string;
  eventType: string;
  strategy?: StrategyType;
  action?: StrategyAction;
  source?: string;
  poolAddress?: string;
  tokenMint?: string;
  walletAddress?: string;
  confidence?: number;
  payload: Record<string, unknown>;
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
  poolName?: string;
  tokenX?: string;
  tokenY?: string;
  tokenXAmount?: number;
  tokenYAmount?: number;
  liquidityUsd?: number;
  feesEarnedUsd?: number;
  pnlUsd?: number;
  pnlPct?: number;
  activeBinId?: number;
  openedAt?: string;
  closedAt?: string;
  signalId?: string;
  intentId?: string;
  mode?: BotMode;
  source?: "paper" | "live";
  status?: "open" | "closed";
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
  minDegenScore?: number;
  minSocialVelocityScore?: number;
  maxPreviousRugsByDev?: number;
  maxWhalePressureScore?: number;
  splitPositionCount?: number;
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
