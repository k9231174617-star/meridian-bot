import { existsSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const buildIndexPath = path.join(workspaceRoot, "artifacts", "meridian", "dist", "public", "index.html");

if (!existsSync(buildIndexPath)) {
  throw new Error(
    `Missing frontend build at ${buildIndexPath}. Run "pnpm build" before the smoke check.`,
  );
}

const child = spawn("pnpm", ["start"], {
  cwd: workspaceRoot,
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});
const childExited = once(child, "exit");

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
  process.stdout.write(chunk);
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
  process.stderr.write(chunk);
});

const shutdown = () => {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
  }
};

process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(143);
});

try {
  await waitFor(async () => {
    const health = await fetch("http://127.0.0.1:8081/api/healthz");
    if (!health.ok) throw new Error(`Health check returned ${health.status}`);

    const root = await fetch("http://127.0.0.1:8081/");
    if (!root.ok) throw new Error(`Root path returned ${root.status}`);

    const contentType = root.headers.get("content-type") ?? "";
    if (!contentType.includes("text/html")) {
      throw new Error(`Expected HTML content type, got "${contentType}"`);
    }
  });

  console.log("Smoke check passed.");
} catch (error) {
  console.error("\nSmoke check failed.");
  console.error(output);
  throw error;
} finally {
  shutdown();
  await childExited.catch(() => undefined);
}

async function waitFor(check: () => Promise<void>, timeoutMs = 30_000) {
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited with code ${child.exitCode}`);
    }

    try {
      await check();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Timed out waiting for production server");
}
