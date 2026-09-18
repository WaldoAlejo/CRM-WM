import { z } from "zod";

// RUC de Ecuador: 13 dígitos numéricos.
const rucSchema = z.string().regex(/^\d{13}$/, "El RUC debe tener 13 dígitos");

export const validateRucSchema = z.object({
  ruc: rucSchema,
});

export const createWholesalerSchema = z.object({
  businessName: z.string().min(1, "La razón social es obligatoria").max(200),
  ruc: rucSchema,
  contactName: z.string().max(120).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email("Email inválido").optional(),
  address: z.string().max(300).optional(),
  creditLimit: z.number().nonnegative().optional(),
  defaultCreditDays: z.number().int().nonnegative().optional(),
});

export const updateWholesalerSchema = createWholesalerSchema.partial();
