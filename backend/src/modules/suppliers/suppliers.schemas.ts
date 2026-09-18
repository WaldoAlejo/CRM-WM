import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  contactInfo: z.string().max(300).optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const listSuppliersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
