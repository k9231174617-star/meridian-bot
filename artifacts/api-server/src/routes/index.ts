import { Router, type IRouter } from "express";
import healthRouter from "./health";
import poolsRouter from "./pools";
import positionsRouter from "./positions";
import pricesRouter from "./prices";
import analyticsRouter from "./analytics";
import botRouter from "./bot";
import paperTradeRouter from "./paper-trade";

const router: IRouter = Router();

router.use("/healthz", healthRouter);
router.use("/pools", poolsRouter);
router.use("/positions", positionsRouter);
router.use("/prices", pricesRouter);
router.use("/analytics", analyticsRouter);
router.use("/bot", botRouter);
router.use("/bot/paper-trade", paperTradeRouter);

export default router;
