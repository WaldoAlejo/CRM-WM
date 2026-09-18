import { z } from "zod";
import { optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/suppliers/suppliers.schemas.ts.
export const supplierFormSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  contactInfo: optionalString(z.string().max(300)),
});

export type SupplierFormValues = z.infer<typeof supplierFormSchema>;

export const supplierDefaultValues: SupplierFormValues = {
  name: "",
  contactInfo: "",
};
