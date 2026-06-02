import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolveStorageDir } from "./bot-status.js";

export type DemoSignalRecord = {
  kind: "signal";
  signal: {
    id: string;
    type: string;
    action: string;
    poolAddress: string;
    poolName: string;
    risk: string;
    confidence: number;
    severity: number;
    reason: string[];
    suggestedCapitalUsd: number;
    slippageBps: number;
    priorityFeeMicroLamports: number;
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
};

export async function appendDemoSignal() {
  const storageDir = resolveStorageDir();
  await mkdir(storageDir, { recursive: true });

  const now = new Date().toISOString();
  const signal: DemoSignalRecord = {
    kind: "signal",
    signal: {
      id: `demo-${randomUUID()}`,
      type: "RUG_SHIELD",
      action: "WATCH",
      poolAddress: "DEMO111111111111111111111111111111111111111",
      poolName: "UI TEST / MERIDIAN",
      risk: "HIGH",
      confidence: 0.97,
      severity: 97,
      reason: [
        "Demo signal injected for dashboard preview",
        "Rug Pull Shield detected elevated contract and holder risk",
        "Execution hints preserved for card layout validation",
      ],
      suggestedCapitalUsd: 250,
      slippageBps: 45,
      priorityFeeMicroLamports: 1500,
      degenScore: 91,
      socialVelocityScore: 76,
      whalePressureScore: 63,
      eventName: "demo_signal",
      executionHints: {
        splitCount: 3,
        minDelayMs: 120,
        maxDelayMs: 420,
        priorityProtection: "MAX",
        phantomLiquidity: true,
        routeAuction: {
          preferredRoute: "JITO",
          candidates: ["JITO", "DIRECT_POOL", "JUPITER"],
          simulationBudgetMs: 80,
        },
        tickRange: {
          lowerBinId: -18,
          upperBinId: 26,
          centerBinId: 4,
          horizonMinutes: 15,
          confidence: 0.92,
          predictedMoveBps: 186,
        },
        relatedPools: ["SOL/USDC", "RAY/USDC"],
        compoundingRatio: 1.18,
        fingerprintRisk: 0.77,
      },
      createdAt: now,
    },
  };

  await appendFile(`${storageDir}/signals.jsonl`, `${JSON.stringify(signal)}\n`, "utf8");
  return signal.signal;
}
