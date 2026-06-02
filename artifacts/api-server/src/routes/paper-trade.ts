import { Router, type Request, type Response } from "express";
import { paperTradeController as controller } from "../lib/paper-trade.js";
const router = Router();

router.get("/status", (_req, res) => {
  res.json(controller.getStatus());
});

router.post("/", async (req: Request, res: Response) => {
  const continuous = req.body?.continuous === true;
  const cycles = continuous ? undefined : (toPositiveInteger(req.body?.cycles) ?? 1);
  const intervalMs = toPositiveInteger(req.body?.intervalMs);
  const debug = normalizeDebug(req.body?.debug);

  try {
    const status = await controller.start({
      ...(continuous ? { continuous: true } : { cycles: cycles ?? 1 }),
      ...(intervalMs ? { intervalMs } : {}),
      ...(debug ? { debug } : {}),
    });
    res.status(202).json(status);
  } catch (error) {
    if (error instanceof Error && error.name === "PaperTradeAlreadyRunningError") {
      res.status(409).json({
        status: controller.getStatus(),
        error: error.message,
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.post("/stop", async (_req: Request, res: Response) => {
  try {
    const status = await controller.stop();
    res.status(202).json(status);
  } catch (error) {
    if (error instanceof Error && error.name === "PaperTradeNotRunningError") {
      res.status(409).json({
        status: controller.getStatus(),
        error: error.message,
      });
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

function toPositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : undefined;
}

function normalizeDebug(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const forceSignal = record.forceSignal === true;
  const bypassRisk = record.bypassRisk === true;
  if (!forceSignal && !bypassRisk) return undefined;
  return { forceSignal, bypassRisk };
}

export default router;
