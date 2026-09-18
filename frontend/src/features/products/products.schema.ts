import { z } from "zod";
import { optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/products/products.schemas.ts. La regla de
// "si cambiás de categoría y el producto ya tenía subcategoría, hay que
// reconfirmarla" no es una validación de FORMA de un campo (por eso no vive
// acá con un .superRefine) — depende de comparar contra el producto
// ORIGINAL y de si el usuario ya interactuó con el select después del
// cambio, algo que ProductFormDialog rastrea con estado de React, no Zod.
export const productFormSchema = z.object({
  sku: z.string().min(1, "El SKU es obligatorio").max(50),
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  description: optionalString(z.string().max(2000)),
  model: optionalString(z.string().max(100)),
  barcode: optionalString(z.string().max(50)),
  categoryId: z.string().min(1, "La categoría es obligatoria"),
  subcategoryId: optionalString(z.string().min(1)),
  brandId: optionalString(z.string().min(1)),
});

export type ProductFormValues = z.infer<typeof productFormSchema>;

export const productDefaultValues: ProductFormValues = {
  sku: "",
  name: "",
  description: "",
  model: "",
  barcode: "",
  categoryId: "",
  subcategoryId: "",
  brandId: "",
};
