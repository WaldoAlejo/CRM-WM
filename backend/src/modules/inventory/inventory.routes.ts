import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createAdjustmentController,
  getStockSummaryController,
  listMovementsController,
} from "./inventory.controller";

export const inventoryRouter = Router();

inventoryRouter.use(requireAuth);

inventoryRouter.get("/movements", asyncHandler(listMovementsController));
inventoryRouter.get("/stock-summary", asyncHandler(getStockSummaryController));

// Ajustes manuales: solo ADMIN (pueden ocultar mermas/errores sin más
// control que el motivo escrito — ver discusión de roles del módulo). Si
// más adelante se decide abrir a OPERATOR también, basta con quitar este
// requireRole.
inventoryRouter.post(
  "/adjustments",
  requireRole(Role.ADMIN),
  asyncHandler(createAdjustmentController)
);
