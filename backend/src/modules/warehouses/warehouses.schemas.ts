import { z } from "zod";

export const createWarehouseSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  address: z.string().max(500).optional(),
});

export const updateWarehouseSchema = createWarehouseSchema.partial();
