import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import {
  deliverShipmentController,
  lostOrDamagedShipmentController,
  rejectShipmentController,
} from "./shipments.controller";

// Reportar lo que dice el courier (entregado/rechazado/perdido) es tarea
// operativa de bodega/logística: admin y operador por igual.
export const shipmentsRouter = Router();
shipmentsRouter.use(requireAuth);

shipmentsRouter.post("/:id/deliver", asyncHandler(deliverShipmentController));
shipmentsRouter.post("/:id/reject", asyncHandler(rejectShipmentController));
shipmentsRouter.post("/:id/lost-or-damaged", asyncHandler(lostOrDamagedShipmentController));
