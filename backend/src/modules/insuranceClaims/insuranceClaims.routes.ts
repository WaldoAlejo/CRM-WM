import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  listInsuranceClaimsController,
  resolveCustomerController,
  updateInsuranceClaimController,
} from "./insuranceClaims.controller";

// Maneja dinero que el courier debe devolver y decisiones de
// reembolso/reemplazo al cliente: ADMIN-only, mismo criterio que
// /inventory/adjustments y los pagos manuales.
export const insuranceClaimsRouter = Router();
insuranceClaimsRouter.use(requireAuth, requireRole(Role.ADMIN));

insuranceClaimsRouter.get("/", asyncHandler(listInsuranceClaimsController));
insuranceClaimsRouter.patch("/:id", asyncHandler(updateInsuranceClaimController));
insuranceClaimsRouter.post("/:id/resolve-customer", asyncHandler(resolveCustomerController));
