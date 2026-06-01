import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { createPaperTradeController } from "./paper-trade.js";

function createMockProcess() {
  const child = new EventEmitter() as EventEmitter & {
    pid: number;
    stdout: EventEmitter & { setEncoding: (encoding: string) => void };
    stderr: EventEmitter & { setEncoding: (encoding: string) => void };
  };

  child.pid = 4242;
  child.stdout = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  child.stderr = new EventEmitter() as EventEmitter & { setEncoding: (encoding: string) => void };
  child.stdout.setEncoding = () => undefined;
  child.stderr.setEncoding = () => undefined;
  return child;
}

test("paper trade controller starts and completes a bounded session", async () => {
  const logs: Array<{ stream: string; line: string }> = [];
  let captured: { command: string; args: string[]; cwd: string } | undefined;
  let child: ReturnType<typeof createMockProcess> | undefined;
  const spawnFn = (command: string, args: string[], options: { cwd?: string }) => {
    captured = { command, args, cwd: options.cwd ?? "" };
    child = createMockProcess();
    queueMicrotask(() => {
      child?.stdout.emit("data", "paper run started\n");
      child?.emit("close", 0, null);
    });
    return child as never;
  };

  const controller = createPaperTradeController({
    workspaceRoot: "/workspace",
    spawnFn: spawnFn as never,
    onLog: (entry) => logs.push(entry),
  });

  const status = await controller.start({ cycles: 3, intervalMs: 4000 });

  assert.equal(captured?.command, "pnpm");
  assert.deepEqual(captured?.args.slice(0, 6), ["--filter", "@workspace/trading-bot", "run", "paper:trade", "--", "--cycles"]);
  assert.equal(captured?.cwd, "/workspace");
  assert.equal(status.status, "completed");
  assert.equal(status.request?.cycles, 3);
  assert.equal(status.request?.intervalMs, 4000);
  assert.equal(logs[0]?.line, "paper run started");
});

test("paper trade controller rejects concurrent sessions", async () => {
  let child: ReturnType<typeof createMockProcess> | undefined;
  const spawnFn = (_command: string, _args: string[], _options: { cwd?: string }) => {
    child = createMockProcess();
    return child as never;
  };
  const controller = createPaperTradeController({
    spawnFn: spawnFn as never,
  });

  const first = controller.start({ cycles: 1 });
  await assert.rejects(controller.start({ cycles: 1 }), /already running/i);
  assert.equal(controller.getStatus().status, "running");
  child?.emit("close", 0, null);
  await first;
});
