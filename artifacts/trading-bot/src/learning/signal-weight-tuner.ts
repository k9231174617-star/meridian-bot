export type SignalWeightKey =
  | "holderGini"
  | "socialVelocity"
  | "mintAuthorityRevoked"
  | "devWalletAge"
  | "tvlSize"
  | "fdvRatio"
  | "previousRugs"
  | "degenScore"
  | "whalePressureScore";

export type SignalWeights = Record<SignalWeightKey, number>;

type GroupState = {
  ema: number;
  count: number;
  sumPnl: number;
};

type FeatureState = {
  high: GroupState;
  low: GroupState;
};

export type SignalWeightState = {
  tradeCount: number;
  weights: SignalWeights;
  features: Record<SignalWeightKey, FeatureState>;
};

export type SignalWeightObservation = {
  rewardUsd: number;
  holderGini: number;
  socialVelocityScore: number;
  mintAuthorityRevoked: boolean;
  devWalletAgeDays: number;
  tvlUsd: number;
  fdvRatio: number;
  previousRugsByDev: number;
  degenScore: number;
  whalePressureScore: number;
};

const FEATURE_THRESHOLDS: Record<SignalWeightKey, number> = {
  holderGini: 0.7,
  socialVelocity: 55,
  mintAuthorityRevoked: 0.5,
  devWalletAge: 30,
  tvlSize: 50_000,
  fdvRatio: 10,
  previousRugs: 0,
  degenScore: 50,
  whalePressureScore: 65,
};

const INVERTED_FEATURES = new Set<SignalWeightKey>(["holderGini", "fdvRatio", "previousRugs", "whalePressureScore"]);

export function createDefaultSignalWeightState(): SignalWeightState {
  return {
    tradeCount: 0,
    weights: Object.fromEntries(Object.keys(FEATURE_THRESHOLDS).map((key) => [key, 1])) as SignalWeights,
    features: Object.fromEntries(Object.keys(FEATURE_THRESHOLDS).map((key) => [key, createFeatureState()])) as Record<SignalWeightKey, FeatureState>,
  };
}

export class SignalWeightTuner {
  constructor(private state: SignalWeightState = createDefaultSignalWeightState()) {}

  observe(observation: SignalWeightObservation) {
    this.state.tradeCount += 1;

    for (const key of Object.keys(this.state.features) as SignalWeightKey[]) {
      const featureState = this.state.features[key];
      const value = featureValue(key, observation);
      const isHigh = value > FEATURE_THRESHOLDS[key];
      const group = isHigh ? featureState.high : featureState.low;
      const alpha = 0.2;
      group.ema = group.count === 0 ? observation.rewardUsd : group.ema * (1 - alpha) + observation.rewardUsd * alpha;
      group.count += 1;
      group.sumPnl += observation.rewardUsd;
    }

    if (this.state.tradeCount % 10 === 0) {
      this.retune();
    }
  }

  getWeights(): SignalWeights {
    return { ...this.state.weights };
  }

  getState(): SignalWeightState {
    return cloneSignalWeightState(this.state);
  }

  setState(state: SignalWeightState) {
    this.state = cloneSignalWeightState(state);
  }

  resetWeights() {
    this.state = createDefaultSignalWeightState();
  }

  private retune() {
    for (const key of Object.keys(this.state.features) as SignalWeightKey[]) {
      const featureState = this.state.features[key];
      if (featureState.high.count === 0 || featureState.low.count === 0) continue;

      const diff = featureState.high.ema - featureState.low.ema;
      const directionalDiff = INVERTED_FEATURES.has(key) ? -diff : diff;
      const magnitude = Math.min(0.25, Math.abs(directionalDiff) / 1_000);
      const delta = directionalDiff >= 0 ? magnitude : -magnitude;
      this.state.weights[key] = round2(clamp(this.state.weights[key] + delta, 0.1, 3));
    }
  }
}

function createFeatureState(): FeatureState {
  return {
    high: { ema: 0, count: 0, sumPnl: 0 },
    low: { ema: 0, count: 0, sumPnl: 0 },
  };
}

function featureValue(key: SignalWeightKey, observation: SignalWeightObservation): number {
  switch (key) {
    case "holderGini":
      return observation.holderGini;
    case "socialVelocity":
      return observation.socialVelocityScore;
    case "mintAuthorityRevoked":
      return observation.mintAuthorityRevoked ? 1 : 0;
    case "devWalletAge":
      return observation.devWalletAgeDays;
    case "tvlSize":
      return observation.tvlUsd;
    case "fdvRatio":
      return observation.fdvRatio;
    case "previousRugs":
      return observation.previousRugsByDev;
    case "degenScore":
      return observation.degenScore;
    case "whalePressureScore":
      return observation.whalePressureScore;
    default:
      return 0;
  }
}

function cloneSignalWeightState(state: SignalWeightState): SignalWeightState {
  return {
    tradeCount: state.tradeCount,
    weights: { ...state.weights },
    features: Object.fromEntries(
      Object.entries(state.features).map(([key, value]) => [
        key,
        { high: { ...value.high }, low: { ...value.low } },
      ]),
    ) as Record<SignalWeightKey, FeatureState>,
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
