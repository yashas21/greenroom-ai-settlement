import { Router, type IRouter } from "express";
import { getAllShows, getShowById, getAllArtists, getReports, getDealAnalysis } from "../lib/queries";

const router: IRouter = Router();

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

export default router;
