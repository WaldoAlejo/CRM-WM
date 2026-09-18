import { z } from "zod";

export const createLocationSchema = z.object({
  code: z.string().min(1, "El código es obligatorio").max(100),
  aisle: z.string().max(100).optional(),
  shelf: z.string().max(100).optional(),
  level: z.string().max(100).optional(),
});

export const updateLocationSchema = createLocationSchema.partial();
