import { BuyerType, DispatchStatus, PaymentMethod, PriceType } from "@prisma/client";
import { z } from "zod";

export const createDispatchOrderSchema = z.object({
  buyerType: z.nativeEnum(BuyerType),
  wholesalerId: z.string().min(1).optional(),
  finalCustomerId: z.string().min(1).optional(),
  shippingProvince: z.string().min(1, "La provincia de despacho es obligatoria"),
  shippingCity: z.string().min(1, "La ciudad de despacho es obligatoria"),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CONTADO),
  reviewIntervalDays: z.number().int().min(1).max(90).default(20),
  creditDays: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive("La cantidad debe ser mayor a 0"),
        priceType: z.nativeEnum(PriceType),
        unitPrice: z.number().nonnegative().optional(),
        markupPct: z.number().min(0).max(10000).multipleOf(0.01).optional(),
        expectedRealCost: z.number().positive().optional(),
        discountPct: z.number().min(0).max(100).optional(),
        // Ubicación de origen elegida al crear la orden. Se usa recién al
        // confirmar (ver confirmDispatchOrder), pero se captura acá porque es
        // donde existe el listado de ítems.
        locationId: z.string().min(1).optional(),
      }).refine(item => item.markupPct !== undefined || item.unitPrice !== undefined, { message: "Ingresa el porcentaje negociado o el precio unitario", path: ["markupPct"] })
        .refine(item => item.markupPct === undefined || !item.discountPct, { message: "No combines incremento sobre costo y descuento", path: ["discountPct"] })
    )
    .min(1, "Debes incluir al menos un ítem"),
});

// Solo relevante si paymentMethod=CONTRA_ENTREGA; si no, se ignora.
export const confirmDispatchOrderSchema = z.object({
  courierId: z.string().min(1).optional(),
  trackingNumber: z.string().max(100).optional(),
});

// El pago puede llegar como JSON o como multipart (cuando lleva foto de
// comprobante): en multipart todo campo es texto, por eso `amount` se coacciona.
export const createPaymentSchema = z.object({
  amount: z.coerce.number().positive("El monto debe ser mayor a 0"),
  method: z.string().min(1, "El método de pago es obligatorio").max(50),
  paidAt: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
});

// Número de factura emitida fuera del sistema. Acepta 001-001-000000123,
// 1-1-123 o los 15 dígitos seguidos, y lo guarda siempre como 001-001-000000123.
// null o "" quita el número registrado.
const manualInvoiceNumber = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === "") return null;
    const parts = /^\d{15}$/.test(value)
      ? [value.slice(0, 3), value.slice(3, 6), value.slice(6)]
      : /^(\d{1,3})-(\d{1,3})-(\d{1,9})$/.exec(value)?.slice(1);
    if (!parts || Number(parts[2]) === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Usa el formato 001-001-000000123" });
      return z.NEVER;
    }
    return `${parts[0].padStart(3, "0")}-${parts[1].padStart(3, "0")}-${parts[2].padStart(9, "0")}`;
  })
  .nullable();

export const manualInvoiceSchema = z.object({ manualInvoiceNumber });

// Una fecha sin hora (lo que envía el filtro) es un día completo en Ecuador:
// "desde" empieza a las 00:00 y "hasta" termina a las 23:59:59.999 (UTC-5).
const ecuadorDay = (edge: "start" | "end") =>
  z.preprocess(
    (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? `${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}-05:00`
      : value,
    z.coerce.date()
  );

export const listDispatchOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(DispatchStatus).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  buyerType: z.nativeEnum(BuyerType).optional(),
  wholesalerId: z.string().optional(),
  finalCustomerId: z.string().optional(),
  shippingProvince: z.string().optional(),
  dateFrom: ecuadorDay("start").optional(),
  dateTo: ecuadorDay("end").optional(),
  // Busca por número de orden, número de factura manual o nombre del comprador.
  q: z.string().trim().max(100).optional(),
  // PENDIENTE = despachos facturables sin número de factura manual registrado.
  invoice: z.enum(["REGISTRADA", "PENDIENTE"]).optional(),
});

export const accountsReceivableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  // Sin `status`: solo las VENCIDAS (el comportamiento de siempre). TODAS = todas
  // las cuentas a crédito con su semáforo.
  status: z.enum(["VENCIDO", "POR_VENCER", "PENDIENTE", "COMPLETADO", "TODAS"]).optional(),
});
