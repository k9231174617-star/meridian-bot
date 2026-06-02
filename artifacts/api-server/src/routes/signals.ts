import { Router } from "express";
import { loadRecentSignals } from "../lib/signals.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const feed = await loadRecentSignals();
    return res.json(feed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

export default router;
