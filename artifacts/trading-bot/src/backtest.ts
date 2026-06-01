import type { MarketSnapshot, BacktestMetrics } from "./domain.js";
import { SignalEngine } from "./signals.js";
import { RiskEngine, type RiskState } from "./risk.js";
import { PaperExecutionClient } from "./execution.js";
import { BotMetrics } from "./observability.js";
import type { BotConfig } from "./config.js";

export async function runBacktest(config: BotConfig, snapshots: MarketSnapshot[]): Promise<BacktestMetrics> {
  const signals = new SignalEngine();
  const risk = new RiskEngine(config.risk);
  const executor = new PaperExecutionClient();
  const metrics = new BotMetrics();
  let previous: MarketSnapshot | undefined;
  let state: RiskState = { openExposureUsd: 0, dailyLossUsd: 0, consecutiveFailures: 0 };

  metrics.recordRunStart(snapshots[0]?.capturedAt ?? new Date().toISOString());

  for (const snapshot of snapshots) {
    metrics.recordCycle();
    metrics.recordSnapshot(snapshot.capturedAt);
    const cycleSignals = signals.generate({ now: snapshot, previous });
    metrics.recordSignals(cycleSignals);

    for (const signal of cycleSignals) {
      const decision = risk.evaluate(signal, state, snapshot);
      metrics.recordApproval(decision.approved);
      if (!decision.approved) continue;

      const intent = risk.buildIntent(signal, decision, "paper");
      const result = await executor.execute(intent);
      metrics.recordExecution(result);
      state = {
        ...state,
        openExposureUsd: state.openExposureUsd + result.filledUsd,
        dailyLossUsd: Math.max(0, state.dailyLossUsd - result.filledUsd * 0.001),
      };
    }

    previous = snapshot;
  }

  const lastSnapshot = snapshots[snapshots.length - 1];
  metrics.recordRunFinish("completed", lastSnapshot?.capturedAt ?? new Date().toISOString());
  return metrics.snapshot();
}
