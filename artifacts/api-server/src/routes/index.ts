import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import authRouter from "./auth";
import expensesRouter from "./expenses";
import itineraryUnlockRouter from "./itinerary-unlock";
import placesRouter from "./places";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(authRouter);
router.use(expensesRouter);
router.use(itineraryUnlockRouter);
router.use(placesRouter);

export default router;
