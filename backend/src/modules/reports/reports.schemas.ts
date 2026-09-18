import { z } from "zod";

export const profitabilityQuerySchema = z.object({
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
  categoryId: z.string().min(1).optional(),
  variantId: z.string().min(1).optional(),
});
