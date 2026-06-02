import { Router } from "express";
import { appendDemoSignal } from "../lib/demo-signal.js";
import { loadRecentSignals } from "../lib/signals.js";

const router = Router();

router.post("/", async (_req, res) => {
  try {
    const signal = await appendDemoSignal();
    const feed = await loadRecentSignals();
    return res.status(201).json({
      ok: true,
      signal,
      feed,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

export default router;
