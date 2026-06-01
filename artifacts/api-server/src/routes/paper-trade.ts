import { Router, type Request, type Response } from "express";
import { createPaperTradeController } from "../lib/paper-trade.js";

const controller = createPaperTradeController();
const router = Router();

router.get("/status", (_req, res) => {
  res.json(controller.getStatus());
});

router.post("/", async (req: Request, res: Response) => {
  const cycles = toPositiveInteger(req.body?.cycles) ?? 1;
  const intervalMs = toPositiveInteger(req.body?.intervalMs);

  try {
    const status = await controller.start({ cycles, intervalMs });
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

function toPositiveInteger(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  const normalized = Math.floor(parsed);
  return normalized > 0 ? normalized : undefined;
}

export default router;
