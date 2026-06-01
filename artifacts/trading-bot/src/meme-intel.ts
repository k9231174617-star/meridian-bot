import type { MarketSnapshot, PoolSnapshot } from "./domain.js";

export type MemeIntelOptions = {
  socialApiUrl?: string;
  eventApiUrl?: string;
};

type RemoteIntel = {
  socialVelocityScore?: number;
  socialVelocityDelta?: number;
  mentionsDelta?: number;
  sentimentScore?: number;
  whaleFlowBps?: number;
  whalePressureScore?: number;
  bondingCurveProgressPct?: number;
  migrateTarget?: PoolSnapshot["migrateTarget"];
  eventWindowActive?: boolean;
  eventName?: string;
  eventBlocksRemaining?: number;
  degenScore?: number;
  holderGini?: number;
  devWalletAgeDays?: number;
  previousRugsByDev?: number;
  contractRiskScore?: number;
  fdvUsd?: number;
};

export class MemeIntelService {
  constructor(private readonly options: MemeIntelOptions = {}) {}

  async enrichSnapshot(snapshot: MarketSnapshot): Promise<MarketSnapshot> {
    const pools = await Promise.all(snapshot.pools.map(async (pool) => this.enrichPool(pool)));
    return { ...snapshot, pools };
  }

  private async enrichPool(pool: PoolSnapshot): Promise<PoolSnapshot> {
    const remoteIntel = await this.fetchRemoteIntel(pool);
    const holderGini = clamp(pickNumber(remoteIntel.holderGini, pool.holderGini ?? estimateHolderGini(pool)) ?? estimateHolderGini(pool), 0, 1);
    const devWalletAgeDays = pickNumber(remoteIntel.devWalletAgeDays, pool.devWalletAgeDays ?? estimateDevWalletAgeDays(pool)) ?? estimateDevWalletAgeDays(pool);
    const previousRugsByDev = pickInteger(remoteIntel.previousRugsByDev, pool.previousRugsByDev ?? estimatePreviousRugs(pool)) ?? estimatePreviousRugs(pool);
    const contractRiskScore = clamp(
      pickNumber(remoteIntel.contractRiskScore, pool.contractRiskScore ?? estimateContractRisk(pool, previousRugsByDev)) ?? estimateContractRisk(pool, previousRugsByDev),
      0,
      100,
    );
    const whaleFlowBps = pickNumber(remoteIntel.whaleFlowBps, pool.whaleFlowBps ?? estimateWhaleFlowBps(pool, holderGini)) ?? estimateWhaleFlowBps(pool, holderGini);
    const whalePressureScore = clamp(
      pickNumber(remoteIntel.whalePressureScore, pool.whalePressureScore ?? estimateWhalePressureScore(pool, whaleFlowBps)) ?? estimateWhalePressureScore(pool, whaleFlowBps),
      0,
      100,
    );
    const socialVelocityScore = clamp(
      pickNumber(remoteIntel.socialVelocityScore, pool.socialVelocityScore ?? estimateSocialVelocityScore(pool)) ?? estimateSocialVelocityScore(pool),
      0,
      100,
    );
    const socialVelocityDelta = pickNumber(
      remoteIntel.socialVelocityDelta,
      pool.socialVelocityDelta ?? estimateSocialVelocityDelta(pool, socialVelocityScore),
    );
    const bondingCurveProgressPct = clamp(
      pickNumber(remoteIntel.bondingCurveProgressPct, pool.bondingCurveProgressPct ?? estimateBondingCurveProgress(pool)) ?? estimateBondingCurveProgress(pool),
      0,
      100,
    );
    const migrateTarget = remoteIntel.migrateTarget ?? pool.migrateTarget ?? inferMigrateTarget(pool, bondingCurveProgressPct);
    const eventWindowActive = pickBoolean(remoteIntel.eventWindowActive, pool.eventWindowActive ?? false) ?? false;
    const eventName = pickString(remoteIntel.eventName, pool.eventName ?? inferEventName(pool, eventWindowActive));
    const eventBlocksRemaining = pickInteger(
      remoteIntel.eventBlocksRemaining,
      pool.eventBlocksRemaining ?? estimateEventBlocksRemaining(pool, eventWindowActive),
    ) ?? estimateEventBlocksRemaining(pool, eventWindowActive);
    const fdvUsd = pickNumber(remoteIntel.fdvUsd, pool.fdvUsd ?? estimateFdvUsd(pool)) ?? estimateFdvUsd(pool);
    const rugRiskScore = clamp(estimateRugRiskScore(pool, contractRiskScore, previousRugsByDev, holderGini), 0, 100);
    const degenScore = clamp(
      pickNumber(remoteIntel.degenScore, pool.degenScore ?? estimateDegenScore({
        ...pool,
        holderGini,
        devWalletAgeDays,
        previousRugsByDev,
        contractRiskScore,
        whalePressureScore,
        socialVelocityScore,
        whaleFlowBps,
        bondingCurveProgressPct,
        migrateTarget,
        eventWindowActive,
        eventName,
        eventBlocksRemaining,
        fdvUsd,
        rugRiskScore,
      })) ?? estimateDegenScore({
        ...pool,
        holderGini,
        devWalletAgeDays,
        previousRugsByDev,
        contractRiskScore,
        whalePressureScore,
        socialVelocityScore,
        whaleFlowBps,
        bondingCurveProgressPct,
        migrateTarget,
        eventWindowActive,
        eventName,
        eventBlocksRemaining,
        fdvUsd,
        rugRiskScore,
      }),
      0,
      100,
    );

    return {
      ...pool,
      holderGini,
      devWalletAgeDays,
      previousRugsByDev,
      contractRiskScore,
      whaleFlowBps,
      whalePressureScore,
      socialVelocityScore,
      socialVelocityDelta,
      bondingCurveProgressPct,
      migrateTarget,
      eventWindowActive,
      eventName,
      eventBlocksRemaining,
      fdvUsd,
      rugRiskScore,
      tokenSafetyScore: round2(Math.max(0, 100 - rugRiskScore)),
      degenScore,
    };
  }

  private async fetchRemoteIntel(pool: PoolSnapshot): Promise<RemoteIntel> {
    const remote = {
      ...(await this.fetchEndpoint(this.options.socialApiUrl, pool, "social")),
      ...(await this.fetchEndpoint(this.options.eventApiUrl, pool, "event")),
    } as RemoteIntel;
    return remote;
  }

  private async fetchEndpoint(url: string | undefined, pool: PoolSnapshot, kind: "social" | "event"): Promise<RemoteIntel> {
    if (!url) return {};

    try {
      const endpoint = new URL(url);
      endpoint.searchParams.set("poolAddress", pool.address);
      endpoint.searchParams.set("symbol", pool.name);
      endpoint.searchParams.set("tokenX", pool.tokenX);
      endpoint.searchParams.set("tokenY", pool.tokenY);
      endpoint.searchParams.set("kind", kind);

      const response = await fetch(endpoint, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return {};
      const payload = await response.json() as Record<string, unknown>;
      return normalizeRemoteIntel(payload);
    } catch {
      return {};
    }
  }
}

function normalizeRemoteIntel(payload: Record<string, unknown>): RemoteIntel {
  return {
    socialVelocityScore: pickNumber(payload.socialVelocityScore, payload.social_velocity_score),
    socialVelocityDelta: pickNumber(payload.socialVelocityDelta, payload.social_velocity_delta),
    mentionsDelta: pickNumber(payload.mentionsDelta, payload.mentions_delta),
    sentimentScore: pickNumber(payload.sentimentScore, payload.sentiment_score),
    whaleFlowBps: pickNumber(payload.whaleFlowBps, payload.whale_flow_bps),
    whalePressureScore: pickNumber(payload.whalePressureScore, payload.whale_pressure_score),
    bondingCurveProgressPct: pickNumber(payload.bondingCurveProgressPct, payload.bonding_curve_progress_pct),
    migrateTarget: pickMigrateTarget(payload.migrateTarget, payload.migrate_target),
    eventWindowActive: pickBoolean(payload.eventWindowActive, payload.event_window_active),
    eventName: pickString(payload.eventName, payload.event_name),
    eventBlocksRemaining: pickInteger(payload.eventBlocksRemaining, payload.event_blocks_remaining),
    degenScore: pickNumber(payload.degenScore, payload.degen_score),
    holderGini: pickNumber(payload.holderGini, payload.holder_gini),
    devWalletAgeDays: pickNumber(payload.devWalletAgeDays, payload.dev_wallet_age_days),
    previousRugsByDev: pickInteger(payload.previousRugsByDev, payload.previous_rugs_by_dev),
    contractRiskScore: pickNumber(payload.contractRiskScore, payload.contract_risk_score),
    fdvUsd: pickNumber(payload.fdvUsd, payload.fdv_usd),
  };
}

function estimateDegenScore(pool: PoolSnapshot & Partial<RemoteIntel>) {
  const liquidityRatio = pool.fdvUsd && pool.fdvUsd > 0 ? pool.tvlUsd / pool.fdvUsd : pool.tvlUsd / Math.max(1, pool.tvlUsd * 8);
  const liquidityScore = clamp(liquidityRatio * 160, 0, 100);
  const holderScore = clamp((1 - clamp(pool.holderGini ?? estimateHolderGini(pool), 0, 1)) * 100, 0, 100);
  const devAgeScore = clamp((pool.devWalletAgeDays ?? estimateDevWalletAgeDays(pool)) * 2, 0, 100);
  const socialScore = clamp(pool.socialVelocityScore ?? estimateSocialVelocityScore(pool), 0, 100);
  const contractScore = clamp(100 - (pool.contractRiskScore ?? estimateContractRisk(pool, pool.previousRugsByDev ?? 0)), 0, 100);
  const rugPenalty = clamp((pool.previousRugsByDev ?? 0) * 12, 0, 60);
  const whalePenalty = clamp((pool.whalePressureScore ?? estimateWhalePressureScore(pool, pool.whaleFlowBps ?? 0)) * 0.35, 0, 35);
  const base = 10
    + liquidityScore * 0.24
    + holderScore * 0.16
    + devAgeScore * 0.14
    + socialScore * 0.2
    + contractScore * 0.18
    - rugPenalty
    - whalePenalty;
  return clamp(base, 0, 100);
}

function estimateHolderGini(pool: PoolSnapshot) {
  const topTen = pool.topTenHolderSharePct ?? pool.topHolderSharePct ?? 30;
  const topOne = pool.topHolderSharePct ?? Math.max(5, topTen / 8);
  return clamp((topTen / 100) * 0.7 + (topOne / 100) * 0.3, 0, 1);
}

function estimateDevWalletAgeDays(pool: PoolSnapshot) {
  if (!pool.createdAt) return 7;
  const createdAt = new Date(pool.createdAt).getTime();
  if (!Number.isFinite(createdAt)) return 7;
  return Math.max(1, Math.round((Date.now() - createdAt) / 86_400_000));
}

function estimatePreviousRugs(pool: PoolSnapshot) {
  if (pool.rugRiskScore && pool.rugRiskScore > 80) return 2;
  return 0;
}

function estimateContractRisk(pool: PoolSnapshot, previousRugsByDev: number) {
  let score = 0;
  if (pool.mintAuthorityRevoked === false) score += 35;
  if (pool.freezeAuthorityRevoked === false) score += 25;
  if (pool.liquidityLocked === false) score += 20;
  if ((pool.topTenHolderSharePct ?? 0) > 85) score += 10;
  if (previousRugsByDev > 0) score += Math.min(20, previousRugsByDev * 8);
  return clamp(score, 0, 100);
}

function estimateWhaleFlowBps(pool: PoolSnapshot, holderGini: number) {
  const concentration = pool.topTenHolderSharePct ?? 55;
  const volumePressure = pool.volume24hUsd > 0 ? (pool.volume24hUsd / Math.max(1, pool.tvlUsd)) * 100 : 0;
  return round2((concentration - 50) * 12 + (holderGini - 0.5) * 1_500 + volumePressure * 2);
}

function estimateWhalePressureScore(pool: PoolSnapshot, whaleFlowBps: number) {
  const concentration = pool.topTenHolderSharePct ?? 55;
  const rugRisk = pool.rugRiskScore ?? 50;
  return clamp((concentration * 0.45) + Math.min(100, Math.abs(whaleFlowBps) / 20) * 0.35 + rugRisk * 0.2, 0, 100);
}

function estimateSocialVelocityScore(pool: PoolSnapshot) {
  const activity = pool.volume24hUsd > 0 && pool.tvlUsd > 0 ? pool.volume24hUsd / pool.tvlUsd : 0;
  const feeMomentum = pool.feeRatePct;
  const smartMoney = pool.smartMoneyScore;
  const signalBias = pool.signalSeed === "ENTER" ? 15 : pool.signalSeed === "WATCH" ? 7 : -10;
  return clamp(20 + activity * 18 + feeMomentum * 9 + smartMoney * 0.35 + signalBias, 0, 100);
}

function estimateSocialVelocityDelta(pool: PoolSnapshot, currentSocialVelocityScore: number) {
  const marketImpulse = pool.signalScore - pool.jupScore;
  return round2((currentSocialVelocityScore - 50) * 0.6 + marketImpulse * 0.4);
}

function estimateBondingCurveProgress(pool: PoolSnapshot) {
  if (typeof pool.bondingCurveProgressPct === "number") return pool.bondingCurveProgressPct;
  if (pool.migrateTarget === "RAYDIUM") return 100;
  if (pool.signalSeed === "ENTER" && pool.tvlUsd < 150_000) return 72;
  if (pool.signalSeed === "WATCH" && pool.tvlUsd < 500_000) return 48;
  return 0;
}

function inferMigrateTarget(pool: PoolSnapshot, bondingCurveProgressPct: number) {
  if (bondingCurveProgressPct >= 100) return "RAYDIUM";
  if (pool.signalSeed === "WATCH" && bondingCurveProgressPct > 60) return "METEORA";
  if (pool.signalScore > 80) return "ORCA";
  return "UNKNOWN";
}

function inferEventName(pool: PoolSnapshot, eventWindowActive: boolean) {
  if (!eventWindowActive) return undefined;
  if (pool.signalSeed === "ENTER") return "Narrative breakout";
  if (pool.signalSeed === "WATCH") return "Community surge";
  return "Event window";
}

function estimateEventBlocksRemaining(pool: PoolSnapshot, eventWindowActive: boolean) {
  if (!eventWindowActive) return undefined;
  if (pool.signalSeed === "ENTER") return 18;
  if (pool.signalSeed === "WATCH") return 36;
  return 12;
}

function estimateFdvUsd(pool: PoolSnapshot) {
  const baseline = pool.tvlUsd > 0 ? pool.tvlUsd * 8 : 100_000;
  const activityPremium = pool.volume24hUsd > 0 ? Math.min(pool.volume24hUsd * 2, baseline * 0.8) : 0;
  return round2(Math.max(10_000, baseline + activityPremium));
}

function estimateRugRiskScore(pool: PoolSnapshot, contractRiskScore: number, previousRugsByDev: number, holderGini: number) {
  const authorityPenalty = (pool.mintAuthorityRevoked === false ? 30 : 0) + (pool.freezeAuthorityRevoked === false ? 20 : 0);
  const liquidityPenalty = pool.liquidityLocked === false ? 15 : 0;
  const holderPenalty = holderGini > 0.65 ? Math.round((holderGini - 0.65) * 100) : 0;
  const devPenalty = previousRugsByDev * 12;
  return clamp(authorityPenalty + liquidityPenalty + holderPenalty + devPenalty + contractRiskScore * 0.55, 0, 100);
}

function pickNumber(...values: Array<unknown>) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function pickInteger(...values: Array<unknown>) {
  const value = pickNumber(...values);
  return value === undefined ? undefined : Math.round(value);
}

function pickBoolean(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "1", "yes", "on", "active", "enabled"].includes(normalized)) return true;
      if (["false", "0", "no", "off", "inactive", "disabled"].includes(normalized)) return false;
    }
  }
  return undefined;
}

function pickString(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function pickMigrateTarget(...values: Array<unknown>): PoolSnapshot["migrateTarget"] | undefined {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().toUpperCase();
    if (normalized === "RAYDIUM" || normalized === "ORCA" || normalized === "METEORA") return normalized;
  }
  return undefined;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
