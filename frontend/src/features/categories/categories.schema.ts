import { z } from "zod";
import { optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/categories/categories.schemas.ts.
export const categoryFormSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(120),
  description: optionalString(z.string().max(500)),
});

export type CategoryFormValues = z.infer<typeof categoryFormSchema>;

export const categoryDefaultValues: CategoryFormValues = {
  name: "",
  description: "",
};
