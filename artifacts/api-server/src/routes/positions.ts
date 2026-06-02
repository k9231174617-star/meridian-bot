import { Router } from "express";
import { GetPositionsQueryParams } from "@workspace/api-zod";
import { DEMO_WALLET_ADDRESS, buildDemoPositions } from "../lib/demo-data";

const router = Router();

const METEORA_API = "https://dlmm-api.meteora.ag";

router.get("/", async (req, res) => {
  try {
    const query = GetPositionsQueryParams.parse({ wallet: req.query.wallet as string });
    const wallet = query.wallet;

    if (!wallet || wallet.length < 32) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const url = `${METEORA_API}/user/${wallet}/positions`;
    let raw: any = null;
    try {
      const r = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(12000),
      });
      if (r.ok) {
        raw = await r.json() as any;
      }
    } catch {
      raw = null;
    }

    const positions = [];
    let totalLiquidityUsd = 0;
    let totalFeesEarned = 0;
    let totalPnlUsd = 0;

    const positionList: any[] = Array.isArray(raw) ? raw : (raw.userPositions || []);
    const demoPositions = wallet === DEMO_WALLET_ADDRESS || positionList.length === 0 ? buildDemoPositions() : [];

    if (demoPositions.length > 0) {
      const totalLiquidityUsd = demoPositions.reduce((sum, position) => sum + position.liquidityUsd, 0);
      const totalFeesEarned = demoPositions.reduce((sum, position) => sum + position.feesEarned, 0);
      const totalPnlUsd = demoPositions.reduce((sum, position) => sum + position.pnlUsd, 0);

      return res.json({
        positions: demoPositions,
        totalLiquidityUsd: Math.round(totalLiquidityUsd * 100) / 100,
        totalFeesEarned: Math.round(totalFeesEarned * 100) / 100,
        totalPnlUsd: Math.round(totalPnlUsd * 100) / 100,
      });
    }

    for (const pos of positionList) {
      try {
        const pairInfo = pos.pair_address
          ? await fetchPairInfo(pos.pair_address)
          : null;

        const liquidityUsd = parseFloat(pos.total_fee_usd_claimed || "0") +
          parseFloat(pos.total_x_amount || "0") * (pairInfo?.currentPriceX || 1) +
          parseFloat(pos.total_y_amount || "0") * (pairInfo?.currentPriceY || 1);

        const feesEarned = parseFloat(pos.total_fee_x_amount || "0") * (pairInfo?.currentPriceX || 1) +
          parseFloat(pos.total_fee_y_amount || "0") * (pairInfo?.currentPriceY || 1);

        const activeBinId = pairInfo?.activeBinId || 0;
        const lowerBinId = pos.position?.lower_bin_id || 0;
        const upperBinId = pos.position?.upper_bin_id || 0;
        const inRange = activeBinId >= lowerBinId && activeBinId <= upperBinId;

        const pnlUsd = feesEarned;
        const pnlPct = liquidityUsd > 0 ? (pnlUsd / liquidityUsd) * 100 : 0;

        totalLiquidityUsd += liquidityUsd;
        totalFeesEarned += feesEarned;
        totalPnlUsd += pnlUsd;

        positions.push({
          address: pos.position?.position_id || pos.position_address || "",
          poolAddress: pos.pair_address || "",
          poolName: pairInfo?.name || "Unknown Pool",
          tokenX: pairInfo?.tokenX || "TOKEN",
          tokenY: pairInfo?.tokenY || "USDC",
          lowerBinId,
          upperBinId,
          activeBinId,
          inRange,
          liquidityUsd: Math.round(liquidityUsd * 100) / 100,
          tokenXAmount: parseFloat(pos.total_x_amount || "0"),
          tokenYAmount: parseFloat(pos.total_y_amount || "0"),
          feesEarned: Math.round(feesEarned * 100) / 100,
          pnlUsd: Math.round(pnlUsd * 100) / 100,
          pnlPct: Math.round(pnlPct * 100) / 100,
          openedAt: pos.created_at || new Date().toISOString(),
        });
      } catch {
        // skip malformed positions
      }
    }

    return res.json({
      positions,
      totalLiquidityUsd: Math.round(totalLiquidityUsd * 100) / 100,
      totalFeesEarned: Math.round(totalFeesEarned * 100) / 100,
      totalPnlUsd: Math.round(totalPnlUsd * 100) / 100,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to fetch positions");
    return res.status(500).json({ error: "Failed to fetch positions" });
  }
});

const pairCache = new Map<string, { data: any; ts: number }>();
async function fetchPairInfo(address: string) {
  const now = Date.now();
  const cached = pairCache.get(address);
  if (cached && now - cached.ts < 60_000) return cached.data;

  try {
    const r = await fetch(`${METEORA_API}/pair/${address}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) return null;
    const p = await r.json() as any;
    const name = p.name || "";
    const parts = name.split("-");
    const info = {
      name,
      tokenX: parts[0] || "TOKEN",
      tokenY: parts[1] || "USDC",
      activeBinId: parseInt(p.active_id || "0"),
      currentPriceX: parseFloat(p.current_price || "1"),
      currentPriceY: 1,
    };
    pairCache.set(address, { data: info, ts: now });
    return info;
  } catch {
    return null;
  }
}

export default router;
