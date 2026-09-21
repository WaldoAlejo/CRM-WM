import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { inspectController, listQueueController } from "./quarantine.controller";

// Cuarentena/Validación: la completa OPERATOR y, por jerarquía, ADMIN y CEO
// (requireRole(OPERATOR) deja pasar a todos los roles autenticados). La cola
// y las respuestas NUNCA traen precios ni costos.
export const quarantineRouter = Router();
quarantineRouter.use(requireAuth, requireRole(Role.OPERATOR));

quarantineRouter.get("/queue", asyncHandler(listQueueController));
quarantineRouter.post("/lines/:id/inspections", asyncHandler(inspectController));
