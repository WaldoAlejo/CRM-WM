import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  addPaymentController,
  cancelDispatchOrderController,
  confirmDispatchOrderController,
  createDispatchOrderController,
  getAccountsReceivableController,
  getDispatchOrderController,
  listDispatchOrdersController,
} from "./dispatchOrders.controller";

// Crear/confirmar/cancelar una orden son tareas operativas del día a día
// (tomar el pedido, despachar): admin y operador por igual, sin restricción
// de campo. Registrar un pago SÍ es ADMIN-only (a diferencia del cobro
// automático que genera /shipments/:id/deliver, que no pasa por acá) — mismo
// patrón que insuranceClaims/reports.
export const dispatchOrdersRouter = Router();
dispatchOrdersRouter.use(requireAuth);

dispatchOrdersRouter.get("/", asyncHandler(listDispatchOrdersController));
dispatchOrdersRouter.get("/:id", asyncHandler(getDispatchOrderController));
dispatchOrdersRouter.post("/", asyncHandler(createDispatchOrderController));
dispatchOrdersRouter.post("/:id/confirm", asyncHandler(confirmDispatchOrderController));
dispatchOrdersRouter.post("/:id/cancel", asyncHandler(cancelDispatchOrderController));
dispatchOrdersRouter.post("/:id/payments", requireRole(Role.ADMIN), asyncHandler(addPaymentController));

export const accountsReceivableRouter = Router();
accountsReceivableRouter.use(requireAuth, requireRole(Role.ADMIN));
accountsReceivableRouter.get("/", asyncHandler(getAccountsReceivableController));
