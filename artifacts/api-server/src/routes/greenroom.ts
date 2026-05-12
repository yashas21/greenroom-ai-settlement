import { Router, type IRouter } from "express";
import { getAllShows, getShowById, getAllArtists, getReports, getDealAnalysis, getNeedsAttention } from "../lib/queries";
import { buildShowExport } from "../lib/showExport";
import { getInsights, enrichSettlements, clearInsightsCache } from "../lib/insights";
import { getLlmStatus, saveLlmSettings, type SaveLlmSettingsInput } from "../lib/llm";

const router: IRouter = Router();

router.get("/shows/:id/export", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const data = await buildShowExport(raw);
    if (!data) {
      res.status(404).json({ error: "Show not found" });
      return;
    }
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "export_failed" });
  }
});

router.get("/shows", async (_req, res): Promise<void> => {
  const rows = await getAllShows();
  res.json(rows);
});

router.get("/shows/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const data = await getShowById(raw);
  if (!data) {
    res.status(404).json({ error: "Show not found" });
    return;
  }
  res.json(data);
});

router.get("/artists", async (_req, res): Promise<void> => {
  const rows = await getAllArtists();
  res.json(rows);
});

router.get("/reports", async (_req, res): Promise<void> => {
  const data = await getReports();
  res.json(data);
});

router.get("/deal-analysis", async (_req, res): Promise<void> => {
  const data = await getDealAnalysis();
  res.json(data);
});

router.get("/needs-attention", async (_req, res): Promise<void> => {
  const data = await getNeedsAttention();
  res.json(data);
});

router.post("/insights/enrich", async (req, res): Promise<void> => {
  try {
    const force = req.query.force === "1" || req.query.force === "true";
    const out = await enrichSettlements({ force });
    clearInsightsCache();
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "enrich_failed" });
  }
});

router.get("/insights", async (_req, res): Promise<void> => {
  try {
    const data = await getInsights();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "insights_failed" });
  }
});

router.get("/settings/llm", async (_req, res): Promise<void> => {
  try {
    res.json(await getLlmStatus());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "llm_status_failed" });
  }
});

router.post("/settings/llm", async (req, res): Promise<void> => {
  try {
    const body = (req.body ?? {}) as SaveLlmSettingsInput;
    await saveLlmSettings(body);
    clearInsightsCache();
    res.json(await getLlmStatus());
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "llm_save_failed" });
  }
});

export default router;
