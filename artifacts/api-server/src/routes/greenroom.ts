import { Router, type IRouter } from "express";
import { getAllShows, getShowById, getAllArtists, getReports, getDealAnalysis, getNeedsAttention } from "../lib/queries";
import { buildShowExport } from "../lib/showExport";
import { getInsights, enrichSettlements, clearInsightsCache } from "../lib/insights";
import { getLlmStatus, saveLlmSettings, type SaveLlmSettingsInput } from "../lib/llm";
import { generateAndPersist, decideSuggestion } from "../lib/smartSwitch";
import { generateAndPersistGuarantee, backfillUpcomingGuarantees } from "../lib/smartGuarantee";
import { getSwitchSavings, getSwitchProjectedGrid } from "../lib/switchSavings";
import { getGuaranteeBacktest } from "../lib/guaranteeBacktest";

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

router.get("/insights/switch-projected-grid", async (req, res): Promise<void> => {
  try {
    const months = Number(req.query.months ?? 6) || 6;
    const data = await getSwitchProjectedGrid({ months });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "projected_grid_failed" });
  }
});

router.get("/insights/guarantee-backtest", async (req, res): Promise<void> => {
  try {
    const months = Number(req.query.months ?? 12) || 12;
    const topN = Number(req.query.topN ?? 10) || 10;
    const data = await getGuaranteeBacktest({ months, topN });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "guarantee_backtest_failed" });
  }
});

router.get("/insights/switch-savings", async (req, res): Promise<void> => {
  try {
    const months = Number(req.query.months ?? 3) || 3;
    const topN = Number(req.query.topN ?? 10) || 10;
    const data = await getSwitchSavings({ months, topN });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "savings_failed" });
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

router.post("/guarantee/backfill", async (req, res): Promise<void> => {
  try {
    const forceAll = req.query.force === "1" || req.query.force === "true";
    const result = await backfillUpcomingGuarantees({ forceAll });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "backfill_failed" });
  }
});

router.post("/shows/:id/guarantee/generate", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const out = await generateAndPersistGuarantee(raw);
    if (!out.suggestion) {
      res.status(409).json({ error: out.reason ?? "could_not_generate" });
      return;
    }
    res.json(out.suggestion);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "generate_failed" });
  }
});

router.post("/shows/:id/switch/generate", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const force = req.query.force === "1" || req.query.force === "true";
  try {
    const out = await generateAndPersist(raw, { force });
    if (!out.suggestion) {
      res.status(409).json({ error: out.reason ?? "could_not_generate" });
      return;
    }
    res.json(out.suggestion);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "generate_failed" });
  }
});

router.post("/shows/:id/switch/accept", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const out = await decideSuggestion(raw, "accepted");
    if (!out) { res.status(404).json({ error: "no_suggestion" }); return; }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "accept_failed" });
  }
});

router.post("/shows/:id/switch/decline", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const out = await decideSuggestion(raw, "declined");
    if (!out) { res.status(404).json({ error: "no_suggestion" }); return; }
    res.json(out);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "decline_failed" });
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
