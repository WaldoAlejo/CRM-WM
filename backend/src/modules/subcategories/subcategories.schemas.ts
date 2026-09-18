import { z } from "zod";

export const createSubcategorySchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(120),
});

export const updateSubcategorySchema = createSubcategorySchema.partial();
