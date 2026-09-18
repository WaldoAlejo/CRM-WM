import { z } from "zod";
import { optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/brands/brands.schemas.ts.
export const brandFormSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  description: optionalString(z.string().max(500)),
});

export type BrandFormValues = z.infer<typeof brandFormSchema>;

export const brandDefaultValues: BrandFormValues = {
  name: "",
  description: "",
};
