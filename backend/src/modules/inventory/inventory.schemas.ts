import { MovementType } from "@prisma/client";
import { z } from "zod";

export const createAdjustmentSchema = z.object({
  variantId: z.string().min(1),
  quantity: z.number().int().refine((v) => v !== 0, "La cantidad no puede ser 0"),
  reason: z.string().min(1, "El motivo es obligatorio").max(500),
  notes: z.string().max(500).optional(),
});

export const listMovementsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  variantId: z.string().optional(),
  type: z.nativeEnum(MovementType).optional(),
  importBatchId: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

export const stockSummaryQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  categoryId: z.string().optional(),
  subcategoryId: z.string().optional(),
  belowMinStock: z.coerce.boolean().optional(),
});
