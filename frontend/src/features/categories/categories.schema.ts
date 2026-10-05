import { z } from "zod";
import { optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/categories/categories.schemas.ts.
export const categoryFormSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(120),
  description: optionalString(z.string().max(500)),
  // Prefijo de los SKU (COC -> COC-0001). Vacío al crear: se sugiere del nombre.
  code: optionalString(z.string().trim().regex(/^[A-Za-z]{2,4}$/, "De 2 a 4 letras, ej: COC")),
});

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export const categoryDefaultValues: CategoryFormValues = {
  name: "",
  description: "",
  code: "",
};
