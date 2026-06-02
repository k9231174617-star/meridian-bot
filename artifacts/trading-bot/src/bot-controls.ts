import { readFile } from "node:fs/promises";
import path from "node:path";

export type BotControls = {
  autoTradingEnabled: boolean;
  updatedAt: string;
};

const DEFAULT_CONTROLS: BotControls = {
  autoTradingEnabled: true,
  updatedAt: new Date().toISOString(),
};

export async function loadBotControls(storageDir?: string): Promise<BotControls> {
  try {
    const raw = await readFile(resolveControlsPath(storageDir), "utf8");
    const parsed = JSON.parse(raw) as Partial<BotControls>;
    return {
      autoTradingEnabled: parsed.autoTradingEnabled !== false,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return { ...DEFAULT_CONTROLS };
  }
}

function resolveControlsPath(storageDir?: string) {
  return path.join(path.resolve(storageDir ?? process.env.BOT_STORAGE_DIR ?? ".bot-data/trading-bot"), "bot-controls.json");
}
