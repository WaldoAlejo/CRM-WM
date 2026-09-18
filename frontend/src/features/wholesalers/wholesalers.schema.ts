import { z } from "zod";
import { optionalEmail, optionalNumber, optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/wholesalers/wholesalers.schemas.ts.
const rucSchema = z.string().regex(/^\d{13}$/, "El RUC debe tener 13 dígitos");

export const wholesalerFormSchema = z.object({
  businessName: z.string().min(1, "La razón social es obligatoria").max(200),
  ruc: rucSchema,
  contactName: optionalString(z.string().max(120)),
  phone: optionalString(z.string().max(30)),
  email: optionalEmail(),
  address: optionalString(z.string().max(300)),
  creditLimit: optionalNumber(z.number().nonnegative("El cupo de crédito no puede ser negativo")),
  defaultCreditDays: optionalNumber(z.number().int().nonnegative("Los días de crédito no pueden ser negativos")),
});

export type WholesalerFormValues = z.infer<typeof wholesalerFormSchema>;

export const wholesalerDefaultValues: WholesalerFormValues = {
  businessName: "",
  ruc: "",
  contactName: "",
  phone: "",
  email: "",
  address: "",
  creditLimit: undefined,
  defaultCreditDays: undefined,
};
