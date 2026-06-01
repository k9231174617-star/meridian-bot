import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export type PaperTradeRequest = {
  cycles: number;
  intervalMs?: number;
};

export type PaperTradeStatus = {
  status: "idle" | "running" | "completed" | "failed";
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

export function createPaperTradeController(options: PaperTradeControllerOptions = {}) {
  const workspaceRoot = options.workspaceRoot ?? resolveWorkspaceRoot();
  const spawnFn = options.spawnFn ?? spawn;
  const onLog = options.onLog ?? defaultLog;

  let state: PaperTradeStatus = { status: "idle" };
  let currentProcess: ChildProcessWithoutNullStreams | null = null;

  return {
    getStatus() {
      return state;
    },
    isRunning() {
      return state.status === "running";
    },
    async start(request: PaperTradeRequest) {
      if (state.status === "running") {
        const error = new Error("Paper trading is already running");
        error.name = "PaperTradeAlreadyRunningError";
        throw error;
      }

      const cycles = Math.max(1, Math.floor(request.cycles));
      const intervalMs = request.intervalMs ? Math.max(1000, Math.floor(request.intervalMs)) : undefined;
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
        request: { cycles, ...(intervalMs ? { intervalMs } : {}) },
      };

      const child = spawnFn("pnpm", args, {
        cwd: workspaceRoot,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      } as SpawnOptionsWithoutStdio);

      currentProcess = child;
      state = { ...state, pid: child.pid ?? undefined };

      pipeOutput(child, onLog);

      return new Promise<PaperTradeStatus>((resolve, reject) => {
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
            status: exitCode === 0 ? "completed" : "failed",
            endedAt: new Date().toISOString(),
            exitCode,
            signal,
          });
        });
      });
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
