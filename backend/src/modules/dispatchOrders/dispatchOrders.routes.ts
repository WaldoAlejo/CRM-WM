import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { uploadPaymentProof } from "../../lib/upload";
import {
  addPaymentController,
  assertOrderExistsMiddleware,
  cancelDispatchOrderController,
  confirmDispatchOrderController,
  createDispatchOrderController,
  getAccountsReceivableController,
  getDispatchOrderController,
  getPaymentProofController,
  immutablePaymentController,
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
// Orden de middlewares a propósito: 1) rol ADMIN/CEO (un OPERATOR nunca llega a
// subir un archivo), 2) la orden existe, 3) recién ahí multer escribe la foto
// opcional `proof` (multipart) — con JSON a secas multer no hace nada.
dispatchOrdersRouter.post(
  "/:id/payments",
  requireRole(Role.ADMIN),
  asyncHandler(assertOrderExistsMiddleware),
  uploadPaymentProof.single("proof"),
  asyncHandler(addPaymentController)
);
// El comprobante contiene datos bancarios de un tercero: solo ADMIN/CEO, y por
// un endpoint autenticado (no existe URL estática). OPERATOR ve el pago pero no
// la imagen. Para abrirlo a OPERATOR bastaría cambiar Role.ADMIN por Role.OPERATOR.
dispatchOrdersRouter.get(
  "/:id/payments/:paymentId/proof",
  requireRole(Role.ADMIN),
  asyncHandler(getPaymentProofController)
);
// Ledger append-only: editar/borrar un pago (o su comprobante) NO existe.
dispatchOrdersRouter.patch("/:id/payments/:paymentId", immutablePaymentController);
dispatchOrdersRouter.put("/:id/payments/:paymentId", immutablePaymentController);
dispatchOrdersRouter.delete("/:id/payments/:paymentId", immutablePaymentController);

export const accountsReceivableRouter = Router();
accountsReceivableRouter.use(requireAuth, requireRole(Role.ADMIN));
accountsReceivableRouter.get("/", asyncHandler(getAccountsReceivableController));
