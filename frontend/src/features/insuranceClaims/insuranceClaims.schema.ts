import { z } from "zod";
import { optionalNumber } from "@/lib/zodHelpers";

// Espejo de resolveCustomerSchema (backend: discriminatedUnion). Acá se
// modela como objeto plano + superRefine (no discriminatedUnion) porque RHF
// necesita un shape único y estable para registrar los campos del form —
// mismo criterio ya usado en dispatchOrderFormSchema para sus reglas
// cruzadas (crédito exclusivo de mayoristas, etc.).
export const resolveCustomerFormSchema = z
  .object({
    resolution: z.enum(["REPLACEMENT", "REFUND"]),
    refundAmount: optionalNumber(z.number().positive("El monto debe ser mayor a 0")),
  })
  .superRefine((values, ctx) => {
    if (values.resolution === "REFUND" && !values.refundAmount) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El monto del reembolso es obligatorio",
        path: ["refundAmount"],
      });
    }
  });

export type ResolveCustomerFormValues = z.infer<typeof resolveCustomerFormSchema>;

export const resolveCustomerDefaultValues: ResolveCustomerFormValues = {
  resolution: "REPLACEMENT",
  refundAmount: undefined,
};

// Espejo de updateInsuranceClaimSchema — mismos 4 estados "editables" (sin
// PENDIENTE, que es solo el default de creación).
export const updateClaimStatusSchema = z.object({
  status: z.enum(["EN_REVISION", "APROBADO", "RECHAZADO", "PAGADO"]),
  reimbursedAmount: optionalNumber(z.number().nonnegative("No puede ser negativo")),
});

export type UpdateClaimStatusFormValues = z.infer<typeof updateClaimStatusSchema>;

export const updateClaimStatusDefaultValues: UpdateClaimStatusFormValues = {
  status: "EN_REVISION",
  reimbursedAmount: undefined,
};
