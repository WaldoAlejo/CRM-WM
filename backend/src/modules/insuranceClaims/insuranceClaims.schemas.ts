import { ClaimStatus } from "@prisma/client";
import { z } from "zod";

// discriminatedUnion: refundAmount es obligatorio SOLO cuando
// resolution=REFUND, sin necesitar un .refine() aparte.
export const resolveCustomerSchema = z.discriminatedUnion("resolution", [
  z.object({ resolution: z.literal("REPLACEMENT") }),
  z.object({
    resolution: z.literal("REFUND"),
    refundAmount: z.number().positive("refundAmount debe ser mayor a 0"),
  }),
]);

// Los 4 estados "editables" desde el courier — PENDIENTE es el default de
// creación, no algo a lo que se pueda volver a mano.
export const updateInsuranceClaimSchema = z.object({
  status: z.enum([
    ClaimStatus.EN_REVISION,
    ClaimStatus.APROBADO,
    ClaimStatus.RECHAZADO,
    ClaimStatus.PAGADO,
  ]),
  reimbursedAmount: z.number().nonnegative().optional(),
});

export const listInsuranceClaimsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  courierId: z.string().min(1).optional(),
  status: z.nativeEnum(ClaimStatus).optional(),
  customerResolution: z.enum(["PENDIENTE", "REEMPLAZO", "REEMBOLSO"]).optional(),
  overdue: z.coerce.boolean().optional(),
  // Permite el link directo "orden → su reclamo" (InsuranceClaim.shipmentId
  // es @unique, así que esto aísla como máximo un resultado) sin tener que
  // buscarlo a mano en el listado — no hay GET /insurance-claims/:id.
  shipmentId: z.string().min(1).optional(),
});
