import { z } from "zod";
import { CATEGORY_CODE_PATTERN } from "../../lib/sku";

// Prefijo de SKU: 2 a 4 letras sin tildes. Vacío/omitido al crear = se sugiere
// a partir del nombre (ej. "Cocina" -> "COC").
const code = z
  .string()
  .trim()
  .toUpperCase()
  .refine((value) => CATEGORY_CODE_PATTERN.test(value), "El código debe tener de 2 a 4 letras (A-Z), ej: COC");

export const createCategorySchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(120),
  description: z.string().max(500).optional(),
  code: z.union([z.literal(""), code]).optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(120).optional(),
  description: z.string().max(500).optional(),
  code: code.optional(),
});
