import { Router, type IRouter } from "express";
import healthRouter from "./health";
import aiRouter from "./ai";
import authRouter from "./auth";
import { paddleRouter } from "./paddle";
import expensesRouter from "./expenses";

const router: IRouter = Router();

router.use(healthRouter);
router.use(aiRouter);
router.use(authRouter);
router.use(paddleRouter);
router.use(expensesRouter);

export default router;
