import { Router } from "express";
import { loadDiscoveryCandidates, loadDiscoveryObservations, loadDiscoverySettings, normalizeDiscoverySettings, parseDexList, saveDiscoverySettings } from "../lib/discovery";
import { resolveStorageDir } from "../lib/bot-status.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const storageDir = resolveStorageDir();
    const [settings, candidates, observations] = await Promise.all([
      loadDiscoverySettings(storageDir, parseDexList(process.env.BOT_ENABLED_DEXES)),
      loadDiscoveryCandidates(storageDir, 100),
      loadDiscoveryObservations(storageDir, 100),
    ]);
    res.json({
      settings,
      candidates,
      observations,
      totals: {
        candidates: candidates.length,
        meteora: candidates.filter((candidate) => candidate.dex === "meteora").length,
        raydium: candidates.filter((candidate) => candidate.dex === "raydium").length,
        orca: candidates.filter((candidate) => candidate.dex === "orca").length,
        observations: observations.length,
        rejected: observations.filter((observation) => observation.status === "rejected").length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

router.put("/", async (req, res) => {
  try {
    const storageDir = resolveStorageDir();
    const settings = normalizeDiscoverySettings({
      enabledDexes: req.body?.enabledDexes,
    }, parseDexList(process.env.BOT_ENABLED_DEXES));
    await saveDiscoverySettings(storageDir, settings);
    const [candidates, observations] = await Promise.all([
      loadDiscoveryCandidates(storageDir, 100),
      loadDiscoveryObservations(storageDir, 100),
    ]);
    res.json({
      settings,
      candidates,
      observations,
      totals: {
        candidates: candidates.length,
        meteora: candidates.filter((candidate) => candidate.dex === "meteora").length,
        raydium: candidates.filter((candidate) => candidate.dex === "raydium").length,
        orca: candidates.filter((candidate) => candidate.dex === "orca").length,
        observations: observations.length,
        rejected: observations.filter((observation) => observation.status === "rejected").length,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: message });
  }
});

export default router;
