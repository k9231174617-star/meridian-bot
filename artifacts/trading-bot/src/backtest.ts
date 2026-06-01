import type { MarketSnapshot, BacktestMetrics } from "./domain.js";
import { SignalEngine } from "./signals.js";
import { RiskEngine, type RiskState } from "./risk.js";
import { PaperExecutionClient } from "./execution.js";
import { BotMetrics } from "./observability.js";
import type { BotConfig } from "./config.js";
import { MemeIntelService } from "./meme-intel.js";

export async function runBacktest(config: BotConfig, snapshots: MarketSnapshot[]): Promise<BacktestMetrics> {
  const memeConfig = (config as BotConfig & { meme?: Partial<BotConfig["meme"]> }).meme ?? {};
  const signals = new SignalEngine(memeConfig);
  const risk = new RiskEngine(config.risk);
  const executor = new PaperExecutionClient();
  const metrics = new BotMetrics();
  const memeIntel = new MemeIntelService({
    socialApiUrl: memeConfig.socialApiUrl,
    eventApiUrl: memeConfig.eventApiUrl,
  });
  let previous: MarketSnapshot | undefined;
  let state: RiskState = { openExposureUsd: 0, dailyLossUsd: 0, consecutiveFailures: 0 };

  metrics.recordRunStart(snapshots[0]?.capturedAt ?? new Date().toISOString());

  for (const snapshot of snapshots) {
    metrics.recordCycle();
    const enrichedSnapshot = await memeIntel.enrichSnapshot(snapshot);
    metrics.recordSnapshot(enrichedSnapshot.capturedAt);
    const cycleSignals = signals.generate({ now: enrichedSnapshot, previous });
    metrics.recordSignals(cycleSignals);

    for (const signal of cycleSignals) {
      const decision = risk.evaluate(signal, state, enrichedSnapshot);
      metrics.recordApproval(decision.approved);
      if (!decision.approved) continue;

      const intent = risk.buildIntent(signal, decision, "paper");
      const result = await executor.execute(intent);
      metrics.recordExecution(result);
      if (typeof signal.impermanentLossPct === "number" && signal.action !== "SWAP") {
        metrics.impermanentLossUsd += Math.max(0, result.filledUsd * (signal.impermanentLossPct / 100));
      }
      state = {
        ...state,
        openExposureUsd: state.openExposureUsd + result.filledUsd,
        dailyLossUsd: Math.max(0, state.dailyLossUsd - result.filledUsd * 0.001),
      };
    }

    previous = enrichedSnapshot;
  }

  const lastSnapshot = snapshots[snapshots.length - 1];
  metrics.recordRunFinish("completed", lastSnapshot?.capturedAt ?? new Date().toISOString());
  return metrics.snapshot();
}
