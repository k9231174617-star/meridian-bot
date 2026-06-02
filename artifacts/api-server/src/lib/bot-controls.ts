import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export type BotControls = {
  autoTradingEnabled: boolean;
  updatedAt: string;
};

const DEFAULT_CONTROLS: BotControls = {
  autoTradingEnabled: false,
  updatedAt: new Date().toISOString(),
};

export async function loadBotControls(storageDir = resolveStorageDir()): Promise<BotControls> {
  try {
    const raw = await readFile(resolveControlsPath(storageDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<BotControls>;
    return {
      autoTradingEnabled: parsed.autoTradingEnabled === true,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return { ...DEFAULT_CONTROLS };
  }
}

export async function saveBotControls(storageDir: string | undefined, controls: BotControls): Promise<BotControls> {
  const next: BotControls = {
    autoTradingEnabled: controls.autoTradingEnabled,
    updatedAt: new Date().toISOString(),
  };
  await mkdir(resolveStorageDir(storageDir), { recursive: true });
  await writeFile(resolveControlsPath(storageDir), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export function resolveStorageDir(storageDir?: string) {
  return path.resolve(storageDir ?? process.env.BOT_STORAGE_DIR ?? ".bot-data/trading-bot");
}

function resolveControlsPath(storageDir?: string) {
  return path.join(resolveStorageDir(storageDir), "bot-controls.json");
}
