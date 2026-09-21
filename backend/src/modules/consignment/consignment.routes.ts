import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createLotController,
  createReviewController,
  getLotController,
  listLotsController,
  overdueReviewsController,
} from "./consignment.controller";

// Crear/liquidar lotes y ver precios: ADMIN o CEO (requireRole(ADMIN) deja
// pasar a CEO por jerarquía). OPERATOR solo accede a Cuarentena (ver
// /api/quarantine) — nunca a lotes, que traen precios.
export const consignmentRouter = Router();
consignmentRouter.use(requireAuth, requireRole(Role.ADMIN));

consignmentRouter.get("/alerts/overdue-reviews", asyncHandler(overdueReviewsController));
consignmentRouter.get("/lots", asyncHandler(listLotsController));
consignmentRouter.post("/lots", asyncHandler(createLotController));
consignmentRouter.get("/lots/:id", asyncHandler(getLotController));
consignmentRouter.post("/lots/:id/reviews", asyncHandler(createReviewController));
