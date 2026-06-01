import type { BotStatusResponse } from "./bot-status.js";
import type { PaperTradeStatus } from "./paper-trade.js";

export function renderPrometheusMetrics(status: BotStatusResponse, paperTrade: PaperTradeStatus) {
  const lines = [
    "# HELP meridian_bot_runs_started_total Total number of recorded bot runs",
    "# TYPE meridian_bot_runs_started_total counter",
    `meridian_bot_runs_started_total ${status.totals.runsStarted}`,
    "# HELP meridian_bot_runs_finished_total Total number of recorded bot run completions",
    "# TYPE meridian_bot_runs_finished_total counter",
    `meridian_bot_runs_finished_total ${status.totals.runsFinished}`,
    "# HELP meridian_bot_alerts_total Total number of recorded alerts",
    "# TYPE meridian_bot_alerts_total counter",
    `meridian_bot_alerts_total ${status.totals.alerts}`,
    "# HELP meridian_bot_alerts_by_severity_total Alerts grouped by severity",
    "# TYPE meridian_bot_alerts_by_severity_total counter",
    `meridian_bot_alerts_by_severity_total{severity="info"} ${status.totals.alertsBySeverity.info}`,
    `meridian_bot_alerts_by_severity_total{severity="warning"} ${status.totals.alertsBySeverity.warning}`,
    `meridian_bot_alerts_by_severity_total{severity="critical"} ${status.totals.alertsBySeverity.critical}`,
    "# HELP meridian_bot_last_run_status Status of the latest bot run",
    "# TYPE meridian_bot_last_run_status gauge",
    `meridian_bot_last_run_status{status="${status.lastRun?.status ?? "none"}"} 1`,
    "# HELP meridian_bot_paper_trade_status Status of the current paper trade controller",
    "# TYPE meridian_bot_paper_trade_status gauge",
    `meridian_bot_paper_trade_status{status="${paperTrade.status}"} 1`,
  ];

  if (status.lastRun?.summary) {
    for (const [key, value] of Object.entries(status.lastRun.summary)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        lines.push(`# HELP meridian_bot_last_run_${key} Summary metric from latest run`);
        lines.push(`# TYPE meridian_bot_last_run_${key} gauge`);
        lines.push(`meridian_bot_last_run_${key} ${value}`);
      }
    }
  }

  if (typeof status.lastRun?.startedAt === "string" && typeof status.lastRun?.endedAt === "string") {
    const durationMs = Math.max(0, new Date(status.lastRun.endedAt).getTime() - new Date(status.lastRun.startedAt).getTime());
    lines.push("# HELP meridian_bot_last_run_duration_ms Duration of the latest completed run in milliseconds");
    lines.push("# TYPE meridian_bot_last_run_duration_ms gauge");
    lines.push(`meridian_bot_last_run_duration_ms ${durationMs}`);
  }

  return `${lines.join("\n")}\n`;
}
