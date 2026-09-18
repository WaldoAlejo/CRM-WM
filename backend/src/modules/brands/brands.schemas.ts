import { z } from "zod";

export const createBrandSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  description: z.string().max(500).optional(),
});

export const updateBrandSchema = createBrandSchema.partial();

export const listBrandsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
