import { ConsignmentStatus, ReviewAction } from "@prisma/client";
import { z } from "zod";

export const createLotSchema = z.object({
  wholesalerId: z.string().min(1),
  shippingProvince: z.string().min(1, "La provincia de despacho es obligatoria"),
  shippingCity: z.string().min(1, "La ciudad de despacho es obligatoria"),
  // Siempre a crédito: 30/60 días. Si se omite se usa el defaultCreditDays del mayorista.
  creditDays: z.number().int().positive().optional(),
  deliveredAt: z.coerce.date().optional(),
  reviewIntervalDays: z.number().int().min(1).max(90).default(20),
  notes: z.string().max(2000).optional(),
  lines: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive("La cantidad debe ser mayor a 0"),
        // Precio mayorista congelado; por defecto el mayorista de lista de la variante.
        unitPrice: z.number().nonnegative().optional(),
        locationId: z.string().min(1).optional(),
      })
    )
    .min(1, "Debes incluir al menos una línea"),
});

export const createReviewSchema = z
  .object({
    action: z.nativeEnum(ReviewAction),
    notes: z.string().max(2000).optional(),
    lines: z
      .array(
        z.object({
          lineId: z.string().min(1),
          quantitySold: z.number().int().min(0),
          quantityReturned: z.number().int().min(0),
        })
      )
      .default([]),
  })
  .superRefine((val, ctx) => {
    if (val.action === ReviewAction.EXTENDER && val.lines.length > 0) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Extender no lleva líneas: no hay cargo ni devolución." });
    }
    if (val.action === ReviewAction.LIQUIDAR && val.lines.length === 0) {
      ctx.addIssue({ code: "custom", path: ["lines"], message: "Liquidar requiere al menos una línea." });
    }
  });

export const listLotsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(ConsignmentStatus).optional(),
  wholesalerId: z.string().optional(),
  overdue: z
    .enum(["true", "false"])
    .transform((v) => v === "true")
    .optional(),
});
