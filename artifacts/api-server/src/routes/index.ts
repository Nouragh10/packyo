import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import authRouter from "./auth";
import { paddleRouter } from "./paddle";
import expensesRouter from "./expenses";
import itineraryUnlockRouter from "./itinerary-unlock";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(authRouter);
router.use(paddleRouter);
router.use(expensesRouter);
router.use(itineraryUnlockRouter);

export default router;
