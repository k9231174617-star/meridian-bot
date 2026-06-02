import { Router } from "express";
import { loadBotStatus } from "../lib/bot-status";
import { loadBotPositions } from "../lib/bot-positions";

const router = Router();

router.get("/status", async (_req, res) => {
  try {
    const status = await loadBotStatus();
    return res.json(status);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load bot status" });
  }
});

router.get("/positions", async (_req, res) => {
  try {
    const positions = await loadBotPositions();
    return res.json(positions);
  } catch (err) {
    return res.status(500).json({ error: "Failed to load bot positions" });
  }
});

export default router;
