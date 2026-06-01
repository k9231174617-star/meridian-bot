import type { Alert } from "./alerts.js";
import type { BacktestMetrics, ExecutionResult, Signal } from "./domain.js";

type Telemetry = {
  status: "idle" | "running" | "completed" | "failed";
  startedAt?: string;
  endedAt?: string;
  lastCycleAt?: string;
  lastExecutionAt?: string;
  lastAlertAt?: string;
  alerts: {
    total: number;
    info: number;
    warning: number;
    critical: number;
  };
  rejections: Record<string, number>;
  durationsMs?: number;
};

export class BotMetrics {
  cycles = 0;
  signals = 0;
  approved = 0;
  rejected = 0;
  fills = 0;
  failed = 0;
  simulatedPnlUsd = 0;
  private equityCurve: number[] = [0];
  private telemetry: Telemetry = {
    status: "idle",
    alerts: { total: 0, info: 0, warning: 0, critical: 0 },
    rejections: {},
  };

  recordRunStart(startedAt = new Date().toISOString()) {
    this.telemetry.status = "running";
    this.telemetry.startedAt = startedAt;
  }

  recordRunFinish(status: "completed" | "failed", endedAt = new Date().toISOString()) {
    this.telemetry.status = status;
    this.telemetry.endedAt = endedAt;
    if (this.telemetry.startedAt) {
      this.telemetry.durationsMs = Math.max(0, new Date(endedAt).getTime() - new Date(this.telemetry.startedAt).getTime());
    }
  }

  recordCycle(now = new Date().toISOString()) {
    this.cycles += 1;
    this.telemetry.lastCycleAt = now;
  }

  recordSignals(signals: Signal[]) {
    this.signals += signals.length;
  }

  recordApproval(approved: boolean) {
    approved ? (this.approved += 1) : (this.rejected += 1);
  }

  recordRejection(reason: string) {
    this.telemetry.rejections[reason] = (this.telemetry.rejections[reason] ?? 0) + 1;
  }

  recordAlert(alert: Alert) {
    this.telemetry.alerts.total += 1;
    this.telemetry.alerts[alert.severity] += 1;
    this.telemetry.lastAlertAt = alert.createdAt;
  }

  recordExecution(result: ExecutionResult) {
    this.telemetry.lastExecutionAt = result.executedAt;

    if (result.status === "filled" || result.status === "simulated") {
      this.fills += 1;
      this.simulatedPnlUsd += Math.max(0, result.filledUsd - result.feesUsd - result.slippageUsd);
      this.pushEquity(this.simulatedPnlUsd);
      return;
    }

    this.failed += 1;
  }

  snapshot(): BacktestMetrics {
    return {
      cycles: this.cycles,
      signals: this.signals,
      approved: this.approved,
      rejected: this.rejected,
      fills: this.fills,
      simulatedPnlUsd: round2(this.simulatedPnlUsd),
      winRate: this.fills > 0 ? round2((this.approved / Math.max(1, this.approved + this.rejected)) * 100) : 0,
      maxDrawdownUsd: round2(this.maxDrawdown()),
    };
  }

  telemetrySnapshot(): Telemetry {
    return {
      ...this.telemetry,
      alerts: { ...this.telemetry.alerts },
      rejections: { ...this.telemetry.rejections },
    };
  }

  log(event: string, data: Record<string, unknown>) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...data }));
  }

  private pushEquity(value: number) {
    this.equityCurve.push(value);
  }

  private maxDrawdown() {
    let peak = 0;
    let maxDrawdown = 0;
    for (const equity of this.equityCurve) {
      peak = Math.max(peak, equity);
      maxDrawdown = Math.max(maxDrawdown, peak - equity);
    }
    return maxDrawdown;
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
