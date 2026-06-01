import { Router } from "express";
import { loadBotStatus } from "../lib/bot-status";

const router = Router();

router.get("/status", async (_req, res) => {
  try {
    const status = await loadBotStatus();
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load bot status" });
  }
});

export default router;
