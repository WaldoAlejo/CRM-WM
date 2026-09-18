import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(120),
  description: z.string().max(500).optional(),
});

export const updateCategorySchema = createCategorySchema.partial();
