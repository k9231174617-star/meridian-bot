import { Router } from "express";
import { GetAnalyticsQueryParams } from "@workspace/api-zod";
import { buildAnalyticsSummary } from "../lib/analytics";

const router = Router();

const METEORA_API = "https://dlmm-api.meteora.ag";

router.get("/", async (req, res) => {
  try {
    const query = GetAnalyticsQueryParams.parse({ wallet: req.query.wallet as string });
    const wallet = query.wallet;

    if (!wallet || wallet.length < 32) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const url = `${METEORA_API}/user/${wallet}/positions`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000) });
      if (r.ok) {
        const raw = await r.json() as any;
        const positionList: any[] = Array.isArray(raw) ? raw : (raw.userPositions || []);
        if (positionList.length === 0) {
          return res.json(buildAnalyticsSummary([]));
        }
        const summary = buildAnalyticsSummary(positionList);
        return res.json(summary);
      }
    } catch {
      return res.json(buildAnalyticsSummary([]));
    }

    return res.json(buildAnalyticsSummary([]));
  } catch (err) {
    req.log.error({ err }, "Failed to fetch analytics");
    return res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

export default router;
