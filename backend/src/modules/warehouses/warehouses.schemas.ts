import { z } from "zod";
import { warehouseLayoutSchema } from "./warehouseLayout";

export const createWarehouseSchema = z.object({
  layout: warehouseLayoutSchema.optional(),
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  address: z.string().max(500).optional(),
  capacity: z.number().int().nonnegative().optional(),
  phone: z.string().max(30).optional(),
  notes: z.string().max(2000).optional(),
  managerId: z.string().min(1).optional(),
});

// Explícito (no un .partial() de createWarehouseSchema): a diferencia de
// crear, editar necesita poder LIMPIAR un campo ya cargado (nullable), no
// solo omitirlo — mismo patrón que variants.schemas.ts.
export const updateWarehouseSchema = z.object({
  layout: warehouseLayoutSchema.optional(),
  name: z.string().min(1, "El nombre es obligatorio").max(200).optional(),
  address: z.string().max(500).nullable().optional(),
  capacity: z.number().int().nonnegative().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  managerId: z.string().min(1).nullable().optional(),
});
