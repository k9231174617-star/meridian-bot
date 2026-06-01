import { loadConfig } from "./config.js";
import { runBot } from "./runner.js";
import { runBacktest } from "./backtest.js";
import { DirectMarketDataProvider } from "./market-data.js";
import { loadBacktestSnapshots } from "./backtest-data.js";

const [, , command = "run", ...args] = process.argv;
const flags = parseFlags(args);

switch (command) {
  case "run":
    await runBot(typeof flags.mode === "string" ? (flags.mode as never) : undefined);
    break;
  case "paper":
    await runBot("paper");
    break;
  case "backtest": {
    const config = loadConfig();
    const snapshots = config.backtestSnapshotsFile
      ? await loadBacktestSnapshots(config.backtestSnapshotsFile)
      : await buildLiveBacktestSnapshots();
    const metrics = await runBacktest(config, snapshots);
    console.log(JSON.stringify({ event: "backtest", metrics }, null, 2));
    break;
  }
  default:
    console.error(`Unknown command: ${command}`);
    process.exitCode = 1;
}

function parseFlags(argv: string[]) {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (!value.startsWith("--")) continue;
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      flags[value.slice(2)] = true;
      continue;
    }
    flags[value.slice(2)] = next;
    i += 1;
  }
  return flags;
}

async function buildLiveBacktestSnapshots() {
  const provider = new DirectMarketDataProvider();
  const snapshots = [];
  for (let i = 0; i < 5; i += 1) {
    snapshots.push(await provider.fetchSnapshot());
  }
  return snapshots;
}
