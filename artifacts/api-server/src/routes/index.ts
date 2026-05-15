import { Router, type IRouter } from "express";
import healthRouter from "./health";
import greenroomRouter from "./greenroom";

const router: IRouter = Router();

router.use(healthRouter);
router.use(greenroomRouter);

export default router;
