import type { MarketSnapshot, Signal } from "../domain.js";

export type LearningStrategy =
  | "conservative"
  | "standard"
  | "aggressive"
  | "sniper_follow"
  | "contrarian";

export type LearningContext = {
  degenScore: number;
  holderGini: number;
  socialVelocityScore: number;
  tvlUsd: number;
  isUnderMevAttack: boolean;
  source?: string;
  hourOfDay: number;
  marketVolatility: number;
};

export type LearningStrategyConfig = {
  positionSizeMultiplier: number;
  tickRangeMultiplier: number;
  minDegenScore: number;
  maxHolderGini: number;
  requireSmartMoney: boolean;
  priorityProtection: "HIGH" | "MAX";
  routePreference: "JUPITER" | "DIRECT_POOL" | "JITO";
  minDelayMs: number;
  maxDelayMs: number;
};

type PosteriorState = {
  mu0: number;
  nu: number;
  alpha: number;
  beta: number;
  n: number;
  xBar: number;
  s: number;
  wins: number;
  losses: number;
  lastRewardUsd?: number;
  lastUpdatedAt?: string;
};

export type LearningBanditState = {
  global: Record<LearningStrategy, PosteriorState>;
  bySource: Record<string, Record<LearningStrategy, PosteriorState>>;
};

export type LearningBanditChoice = {
  strategy: LearningStrategy;
  score: number;
  config: LearningStrategyConfig;
  sourceScoped: boolean;
};

const STRATEGIES: LearningStrategy[] = ["conservative", "standard", "aggressive", "sniper_follow", "contrarian"];

const STRATEGY_CONFIGS: Record<LearningStrategy, LearningStrategyConfig> = {
  conservative: { positionSizeMultiplier: 0.75, tickRangeMultiplier: 1.2, minDegenScore: 55, maxHolderGini: 0.48, requireSmartMoney: false, priorityProtection: "HIGH", routePreference: "JUPITER", minDelayMs: 120, maxDelayMs: 1_500 },
  standard: { positionSizeMultiplier: 1, tickRangeMultiplier: 1, minDegenScore: 40, maxHolderGini: 0.62, requireSmartMoney: false, priorityProtection: "HIGH", routePreference: "JUPITER", minDelayMs: 0, maxDelayMs: 900 },
  aggressive: { positionSizeMultiplier: 1.2, tickRangeMultiplier: 0.9, minDegenScore: 28, maxHolderGini: 0.78, requireSmartMoney: true, priorityProtection: "MAX", routePreference: "DIRECT_POOL", minDelayMs: 0, maxDelayMs: 250 },
  sniper_follow: { positionSizeMultiplier: 1.4, tickRangeMultiplier: 0.72, minDegenScore: 35, maxHolderGini: 0.82, requireSmartMoney: true, priorityProtection: "MAX", routePreference: "JITO", minDelayMs: 0, maxDelayMs: 120 },
  contrarian: { positionSizeMultiplier: 0.9, tickRangeMultiplier: 1.3, minDegenScore: 24, maxHolderGini: 0.9, requireSmartMoney: false, priorityProtection: "HIGH", routePreference: "DIRECT_POOL", minDelayMs: 80, maxDelayMs: 1_100 },
};

const MIN_SOURCE_TRADES = 30;

export function createDefaultLearningBanditState(): LearningBanditState {
  return {
    global: Object.fromEntries(STRATEGIES.map((strategy) => [strategy, createPosteriorState()])) as Record<LearningStrategy, PosteriorState>,
    bySource: {},
  };
}

export class ContextualBandit {
  constructor(private state: LearningBanditState = createDefaultLearningBanditState()) {}

  selectStrategy(context: LearningContext): LearningBanditChoice {
    const bucket = this.selectBucket(context.source);
    let best: LearningBanditChoice | null = null;

    for (const strategy of STRATEGIES) {
      const posterior = bucket[strategy] ?? this.state.global[strategy];
      const score = samplePosteriorReward(posterior) + contextBonus(strategy, context);
      const candidate: LearningBanditChoice = {
        strategy,
        score,
        config: STRATEGY_CONFIGS[strategy],
        sourceScoped: Boolean(context.source && bucket[strategy]),
      };
      if (!best || candidate.score > best.score) best = candidate;
    }

    return best ?? { strategy: "standard", score: 0, config: STRATEGY_CONFIGS.standard, sourceScoped: false };
  }

  update(strategy: LearningStrategy, context: LearningContext, pnlUsd: number, feesUsd: number, slippageUsd: number) {
    const reward = pnlUsd - feesUsd - slippageUsd;
    const updatedAt = new Date().toISOString();
    this.state.global[strategy] = updatePosterior(this.state.global[strategy], reward, updatedAt);

    if (context.source) {
      const bucket = this.state.bySource[context.source] ?? createSourceBucket();
      bucket[strategy] = updatePosterior(bucket[strategy], reward, updatedAt);
      this.state.bySource[context.source] = bucket;
    }
  }

  maybeBackfillSource(source?: string, tradesObserved = 0) {
    if (!source || tradesObserved < MIN_SOURCE_TRADES) return false;
    this.state.bySource[source] ??= createSourceBucket();
    return true;
  }

  getState(): LearningBanditState {
    return cloneBanditState(this.state);
  }

  setState(state: LearningBanditState) {
    this.state = cloneBanditState(state);
  }

  getTopStrategy(context?: LearningContext): LearningStrategy {
    if (context) return this.selectStrategy(context).strategy;
    return STRATEGIES.reduce((best, strategy) => (this.state.global[strategy].mu0 > this.state.global[best].mu0 ? strategy : best), STRATEGIES[0] ?? "standard");
  }

  private selectBucket(source?: string) {
    if (!source) return {} as Partial<Record<LearningStrategy, PosteriorState>>;
    const bucket = this.state.bySource[source];
    if (!bucket) return {} as Partial<Record<LearningStrategy, PosteriorState>>;
    const count = Object.values(bucket).reduce((sum, state) => sum + state.n, 0);
    return count >= MIN_SOURCE_TRADES ? bucket : ({} as Partial<Record<LearningStrategy, PosteriorState>>);
  }
}

function createPosteriorState(): PosteriorState {
  return { mu0: 0, nu: 1, alpha: 1, beta: 1, n: 0, xBar: 0, s: 0, wins: 0, losses: 0 };
}

function createSourceBucket(): Record<LearningStrategy, PosteriorState> {
  return Object.fromEntries(STRATEGIES.map((strategy) => [strategy, createPosteriorState()])) as Record<LearningStrategy, PosteriorState>;
}

function updatePosterior(previous: PosteriorState, reward: number, updatedAt: string): PosteriorState {
  const n = previous.n + 1;
  const delta = reward - previous.xBar;
  const xBar = previous.xBar + delta / n;
  const s = previous.s + delta * (reward - xBar);
  return {
    mu0: xBar,
    nu: previous.nu + 1,
    alpha: previous.alpha + 0.5,
    beta: Math.max(1e-6, previous.beta + 0.5 * s + (previous.nu * delta * delta) / (2 * (previous.nu + 1))),
    n,
    xBar,
    s,
    wins: previous.wins + (reward > 0 ? 1 : 0),
    losses: previous.losses + (reward <= 0 ? 1 : 0),
    lastRewardUsd: reward,
    lastUpdatedAt: updatedAt,
  };
}

function samplePosteriorReward(state: PosteriorState): number {
  const scale = Math.sqrt(Math.max(1e-6, state.beta * (state.nu + 1) / Math.max(1e-6, state.alpha * state.nu)));
  return state.mu0 + scale * sampleStudentT(Math.max(2, Math.round(2 * state.alpha)));
}

function sampleStudentT(degreesOfFreedom: number): number {
  const z = sampleStandardNormal();
  const chiSquare = 2 * sampleGamma(Math.max(1, degreesOfFreedom / 2), 1);
  return z / Math.sqrt(Math.max(1e-6, chiSquare / Math.max(1, degreesOfFreedom)));
}

function sampleStandardNormal(): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function sampleGamma(shape: number, scale: number): number {
  if (shape < 1) {
    const u = Math.random();
    return sampleGamma(1 + shape, scale) * Math.pow(u, 1 / shape);
  }

  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  while (true) {
    let x = 0;
    let v = 0;
    do {
      x = sampleStandardNormal();
      v = 1 + c * x;
    } while (v <= 0);
    v **= 3;
    const u = Math.random();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v * scale;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
  }
}

function contextBonus(strategy: LearningStrategy, context: LearningContext): number {
  const highVolatilityBonus = clamp01(context.marketVolatility / 100) * 0.8;
  const mevBonus = context.isUnderMevAttack ? 0.9 : 0;
  const socialBias = clamp01(context.socialVelocityScore / 100);
  const safeBias = clamp01(1 - context.holderGini);
  const valueBias = clamp01(context.tvlUsd / 500_000);

  switch (strategy) {
    case "conservative":
      return safeBias * 1.2 + (1 - highVolatilityBonus) * 0.6 + (1 - socialBias) * 0.2;
    case "standard":
      return 0.15 + valueBias * 0.2;
    case "aggressive":
      return socialBias * 1.1 + highVolatilityBonus * 0.9 + valueBias * 0.15;
    case "sniper_follow":
      return mevBonus + (context.source?.includes("sniper") ? 0.8 : 0) + highVolatilityBonus * 0.35;
    case "contrarian":
      return (1 - socialBias) * 0.8 + (context.holderGini > 0.65 ? 0.4 : 0) + highVolatilityBonus * 0.2;
    default:
      return 0;
  }
}

function cloneBanditState(state: LearningBanditState): LearningBanditState {
  return {
    global: cloneBucket(state.global),
    bySource: Object.fromEntries(Object.entries(state.bySource).map(([source, bucket]) => [source, cloneBucket(bucket)])),
  };
}

function cloneBucket(bucket: Record<LearningStrategy, PosteriorState>): Record<LearningStrategy, PosteriorState> {
  return Object.fromEntries(STRATEGIES.map((strategy) => [strategy, { ...bucket[strategy] }])) as Record<LearningStrategy, PosteriorState>;
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
