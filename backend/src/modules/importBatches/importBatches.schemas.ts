import { z } from "zod";

export const createImportBatchSchema = z.object({
  reference: z.string().min(1, "La referencia/contenedor es obligatoria").max(100),
  supplierId: z.string().min(1).optional(),
  arrivalDate: z.coerce.date(),
  notes: z.string().max(2000).optional(),
  freightCost: z.number().nonnegative().optional(),
  customsCost: z.number().nonnegative().optional(),
  otherCosts: z.number().nonnegative().optional(),
});

export const receiveStockSchema = z.object({
  lines: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive("La cantidad de un ingreso debe ser mayor a 0"),
        unitCost: z.number().nonnegative("El costo unitario no puede ser negativo"),
        notes: z.string().max(500).optional(),
      })
    )
    .min(1, "Debes incluir al menos una línea"),
});

export const listImportBatchesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  supplierId: z.string().optional(),
});
