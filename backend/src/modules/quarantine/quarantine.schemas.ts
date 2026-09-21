import { ReturnSource } from "@prisma/client";
import { z } from "zod";

export const queueQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  source: z.nativeEnum(ReturnSource).optional(),
  warehouseId: z.string().optional(),
});

// Ítems FIJOS del checklist (genéricos). El resultado (PASA/NO_PASA) NO viaja
// acá: lo deriva el servidor. `observation` es el "otro / observación libre".
export const inspectionSchema = z.object({
  quantity: z.number().int().positive("La cantidad debe ser mayor a 0"),
  boxOk: z.boolean(),
  noVisibleDamage: z.boolean(),
  piecesComplete: z.boolean(),
  observation: z.string().max(1000).optional(),
});
