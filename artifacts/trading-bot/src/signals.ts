import { createHash } from "node:crypto";
import type { MarketSnapshot, PoolSnapshot, Signal, TradeAction } from "./domain.js";

export type SignalContext = {
  previous?: MarketSnapshot;
  now: MarketSnapshot;
};

export class SignalEngine {
  generate(context: SignalContext): Signal[] {
    const signals: Signal[] = [];

    for (const pool of context.now.pools) {
      const previous = context.previous?.pools.find((item) => item.address === pool.address);
      const deltas = computeDeltas(pool, previous);
      const baseScore = pool.signalScore;
      const reasons: string[] = [];
      let type: Signal["type"] = "FEE_MOMENTUM";
      let action: TradeAction = "WAIT";
      let confidence = clamp01(baseScore / 100);
      let severity = Math.round(baseScore * 0.75);
      let capitalScale = 0.25;
      let slippageBps = 50;
      let priorityFeeMicroLamports = 1_500;

      if (pool.ilRisk === "HIGH" && baseScore < 70) {
        type = "RISK_EXIT";
        action = "REMOVE_LIQUIDITY";
        reasons.push("High IL risk with insufficient score");
        capitalScale = 0.15;
        confidence = Math.max(confidence, 0.7);
        severity = 90;
        slippageBps = 35;
        priorityFeeMicroLamports = 2_000;
      } else if (deltas.liquidityPct > 20 && deltas.volumePct > 20 && pool.ilRisk !== "HIGH") {
        type = "LIQUIDITY_SURGE";
        action = "ADD_LIQUIDITY";
        reasons.push(`Liquidity up ${formatPct(deltas.liquidityPct)}`);
        reasons.push(`Volume up ${formatPct(deltas.volumePct)}`);
        capitalScale = 0.2;
        confidence = Math.min(0.95, confidence + 0.18);
        severity = Math.min(100, severity + 12);
        slippageBps = 60;
        priorityFeeMicroLamports = 1_800;
      } else if (Math.abs(pool.currentPrice) > 0 && Math.abs(deltas.pricePct) > 12) {
        type = "PRICE_DISLOCATION";
        action = "SWAP";
        reasons.push(`Price moved ${formatPct(deltas.pricePct)}`);
        reasons.push("Potential hedge or re-entry opportunity");
        capitalScale = 0.18;
        confidence = Math.min(0.9, confidence + 0.12);
        severity = Math.min(100, severity + 18);
        slippageBps = 70;
        priorityFeeMicroLamports = 2_200;
      } else if (pool.feeRatePct > 0.4 && pool.jupScore >= 65) {
        type = "FEE_MOMENTUM";
        action = "ADD_LIQUIDITY";
        reasons.push("Healthy fee rate and score");
        reasons.push(`Fee rate ${pool.feeRatePct.toFixed(2)}%`);
        capitalScale = 0.22;
        confidence = Math.min(0.92, confidence + 0.1);
        severity = Math.min(100, severity + 8);
        slippageBps = 55;
        priorityFeeMicroLamports = 1_600;
      }

      if (deltas.liquidityPct < -15 || deltas.volumePct < -20) {
        reasons.push("Liquidity or volume weakening vs previous cycle");
        severity = Math.max(severity, 70);
        confidence = Math.max(0.45, confidence - 0.08);
      }

      if (action !== "WAIT") {
        const createdAt = context.now.capturedAt;
        const id = createSignalId({
          snapshotAt: createdAt,
          poolAddress: pool.address,
          poolName: pool.name,
          type,
          action,
          confidence: round2(confidence),
          severity,
          capitalUsd: round2(pool.tvlUsd * capitalScale),
          slippageBps,
          priorityFeeMicroLamports,
        });

        signals.push({
          id,
          type,
          action,
          poolAddress: pool.address,
          poolName: pool.name,
          risk: pool.ilRisk,
          confidence: round2(confidence),
          severity,
          reason: reasons,
          suggestedCapitalUsd: round2(pool.tvlUsd * capitalScale),
          slippageBps,
          priorityFeeMicroLamports,
          createdAt,
        });
      }
    }

    signals.sort((a, b) => b.severity - a.severity || b.confidence - a.confidence);
    return signals;
  }
}

function computeDeltas(pool: PoolSnapshot, previous?: PoolSnapshot) {
  if (!previous || previous.tvlUsd <= 0 || previous.volume24hUsd <= 0 || previous.currentPrice <= 0) {
    return { liquidityPct: 0, volumePct: 0, pricePct: 0 };
  }

  return {
    liquidityPct: ((pool.tvlUsd - previous.tvlUsd) / previous.tvlUsd) * 100,
    volumePct: ((pool.volume24hUsd - previous.volume24hUsd) / previous.volume24hUsd) * 100,
    pricePct: ((pool.currentPrice - previous.currentPrice) / previous.currentPrice) * 100,
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function formatPct(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function createSignalId(input: Record<string, unknown>) {
  return `sig_${createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 24)}`;
}
