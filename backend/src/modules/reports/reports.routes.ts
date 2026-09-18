import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  getProfitabilityReportController,
  getProfitabilitySummaryController,
} from "./reports.controller";

// Reportes de rentabilidad: exponen costo (unitCostSnapshot/landedCostSnapshot)
// y margen a nivel de línea de producto — ADMIN-only, sin excepción.
export const reportsRouter = Router();
reportsRouter.use(requireAuth, requireRole(Role.ADMIN));

reportsRouter.get("/profitability", asyncHandler(getProfitabilityReportController));
reportsRouter.get("/profitability/summary", asyncHandler(getProfitabilitySummaryController));
