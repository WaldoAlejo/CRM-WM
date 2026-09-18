import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { getDashboardSummaryController } from "./dashboard.controller";

export const dashboardRouter = Router();

// Cualquier usuario autenticado (ADMIN u OPERATOR): el filtrado por rol pasa
// DENTRO de getDashboardSummary, igual que Productos/Variantes — nunca un
// requireRole acá, porque OPERATOR sí debe recibir su propia versión
// (recortada) de la respuesta, no un 403.
dashboardRouter.use(requireAuth);
dashboardRouter.get("/summary", asyncHandler(getDashboardSummaryController));
