import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { forbidFieldsForRole } from "../../middleware/fieldPermissions";
import { IMPORT_BATCH_COST_FIELDS } from "./importBatches.serializer";
import {
  createImportBatchController,
  getImportBatchController,
  listImportBatchesController,
  receiveStockController,
} from "./importBatches.controller";

export const importBatchesRouter = Router();

importBatchesRouter.use(requireAuth);

// Lectura: admin y operador (con costos ocultos para operador vía el serializer).
importBatchesRouter.get("/", asyncHandler(listImportBatchesController));
importBatchesRouter.get("/:id", asyncHandler(getImportBatchController));

// Crear lote: admin y operador, pero los 3 campos de costo son admin-only
// (mismo patrón que precios de variante).
importBatchesRouter.post(
  "/",
  forbidFieldsForRole(IMPORT_BATCH_COST_FIELDS, Role.OPERATOR),
  asyncHandler(createImportBatchController)
);

// Recibir mercadería: admin y operador, SIN restricción de campo — unitCost
// acá es un hecho operativo de la recepción física, no estrategia de venta.
importBatchesRouter.post("/:id/receive", asyncHandler(receiveStockController));
