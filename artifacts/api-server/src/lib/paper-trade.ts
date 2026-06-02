import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PaperTradeRequest = {
  cycles: number;
  intervalMs?: number;
  debug?: {
    forceSignal?: boolean;
    bypassRisk?: boolean;
  };
};

export type PaperTradeStatus = {
  status: "idle" | "running" | "stopping" | "completed" | "failed";
  pid?: number;
  startedAt?: string;
  endedAt?: string;
  command?: string[];
  request?: PaperTradeRequest;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  error?: string;
};

type SpawnFn = (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;

export type PaperTradeControllerOptions = {
  workspaceRoot?: string;
  spawnFn?: SpawnFn;
  onLog?: (entry: { stream: "stdout" | "stderr"; line: string }) => void;
};

export const paperTradeController = createPaperTradeController();

export function createPaperTradeController(options: PaperTradeControllerOptions = {}) {
  const workspaceRoot = options.workspaceRoot ?? resolveWorkspaceRoot();
  const spawnFn = options.spawnFn ?? spawn;
  const onLog = options.onLog ?? defaultLog;

  let state: PaperTradeStatus = { status: "idle" };
  let currentProcess: ChildProcessWithoutNullStreams | null = null;
  let activeRun: Promise<PaperTradeStatus> | null = null;
  let stopRequested = false;

  return {
    getStatus() {
      return state;
    },
    isRunning() {
      return state.status === "running" || state.status === "stopping";
    },
    async start(request: PaperTradeRequest) {
      if (this.isRunning()) {
        const error = new Error("Paper trading is already running");
        error.name = "PaperTradeAlreadyRunningError";
        throw error;
      }

      const cycles = Math.max(1, Math.floor(request.cycles));
      const intervalMs = request.intervalMs ? Math.max(1000, Math.floor(request.intervalMs)) : undefined;
      const debug = normalizeDebugOptions(request.debug);
      const storageDir = path.join(workspaceRoot, ".bot-data", "trading-bot");
      const args = [
        "--filter",
        "@workspace/trading-bot",
        "run",
        "paper:trade",
        "--",
        "--cycles",
        String(cycles),
      ];

      if (typeof intervalMs === "number") {
        args.push("--intervalMs", String(intervalMs));
      }

      const startedAt = new Date().toISOString();
      state = {
        status: "running",
        startedAt,
        pid: undefined,
        command: ["pnpm", ...args],
        request: { cycles, ...(intervalMs ? { intervalMs } : {}), ...(debug ? { debug } : {}) },
      };

      const env = {
        ...process.env,
        BOT_STORAGE_DIR: storageDir,
        BOT_ENABLE_WSS_POOL_WATCHER: "false",
        BOT_DISCOVERY_BACKFILL_LIMIT: "1",
        YELLOWSTONE_ENDPOINT: "",
        YELLOWSTONE_TOKEN: "",
        BOT_RPC_URL: "",
        BOT_RPC_WS_URL: "",
        RPC_URL: "",
        WS_URL: "",
        rpc_url: "",
        ws_url: "",
        yellowstone_endpoint: "",
        yellowstone_token: "",
        ...(debug?.forceSignal ? { BOT_PAPER_DEBUG_FORCE_SIGNAL: "true" } : {}),
        ...(debug?.bypassRisk ? { BOT_PAPER_DEBUG_BYPASS_RISK: "true" } : {}),
      };

      const child = spawnFn("pnpm", args, {
        cwd: workspaceRoot,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      } as SpawnOptionsWithoutStdio);

      currentProcess = child;
      stopRequested = false;
      state = { ...state, pid: child.pid ?? undefined };

      pipeOutput(child, onLog);

      activeRun = new Promise<PaperTradeStatus>((resolve, reject) => {
        let settled = false;

        const finish = (next: PaperTradeStatus) => {
          if (settled) return;
          settled = true;
          state = next;
          currentProcess = null;
          resolve(state);
        };

        child.once("error", (error) => {
          finish({
            ...state,
            status: "failed",
            endedAt: new Date().toISOString(),
            error: error instanceof Error ? error.message : String(error),
          });
          reject(error);
        });

        child.once("close", (exitCode, signal) => {
          finish({
            ...state,
            status: stopRequested ? "stopping" : exitCode === 0 ? "completed" : "failed",
            endedAt: new Date().toISOString(),
            exitCode,
            signal,
          });
        });
      });

      return activeRun;
    },
    async stop() {
      if (!currentProcess || !this.isRunning()) {
        const error = new Error("Paper trading is not running");
        error.name = "PaperTradeNotRunningError";
        throw error;
      }

      stopRequested = true;
      state = { ...state, status: "stopping" };
      currentProcess.kill("SIGTERM");

      if (activeRun) {
        const result = await activeRun;
        state = { ...result, status: "idle" };
        return state;
      }

      state = { status: "idle" };
      return state;
    },
  };
}

export function resolveWorkspaceRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

function pipeOutput(child: ChildProcessWithoutNullStreams, onLog: NonNullable<PaperTradeControllerOptions["onLog"]>) {
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
      onLog({ stream: "stdout", line });
    }
  });

  child.stderr.on("data", (chunk) => {
    for (const line of String(chunk).split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)) {
      onLog({ stream: "stderr", line });
    }
  });
}

function defaultLog(entry: { stream: "stdout" | "stderr"; line: string }) {
  const prefix = entry.stream === "stderr" ? "paper_trade_stderr" : "paper_trade_stdout";
  console.log(JSON.stringify({ event: prefix, line: entry.line }));
}

function normalizeDebugOptions(debug?: PaperTradeRequest["debug"]) {
  if (!debug) return undefined;
  const forceSignal = debug.forceSignal === true;
  const bypassRisk = debug.bypassRisk === true;
  if (!forceSignal && !bypassRisk) return undefined;
  return { forceSignal, bypassRisk };
}
