import { Router, type Request, type Response } from "express";
import { loadBotControls, saveBotControls } from "../lib/bot-controls.js";

const router = Router();

router.get("/", async (_req: Request, res: Response) => {
  try {
    const controls = await loadBotControls();
    res.json(controls);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.patch("/", async (req: Request, res: Response) => {
  try {
    const current = await loadBotControls();
    const autoTradingEnabled = typeof req.body?.autoTradingEnabled === "boolean"
      ? req.body.autoTradingEnabled
      : current.autoTradingEnabled;
    const next = await saveBotControls(undefined, { autoTradingEnabled, updatedAt: current.updatedAt });
    res.json(next);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
