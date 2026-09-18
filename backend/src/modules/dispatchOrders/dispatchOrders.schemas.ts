import { BuyerType, DispatchStatus, PaymentMethod, PriceType } from "@prisma/client";
import { z } from "zod";

export const createDispatchOrderSchema = z.object({
  buyerType: z.nativeEnum(BuyerType),
  wholesalerId: z.string().min(1).optional(),
  finalCustomerId: z.string().min(1).optional(),
  shippingProvince: z.string().min(1, "La provincia de despacho es obligatoria"),
  shippingCity: z.string().min(1, "La ciudad de despacho es obligatoria"),
  paymentMethod: z.nativeEnum(PaymentMethod).default(PaymentMethod.CONTADO),
  creditDays: z.number().int().positive().optional(),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        variantId: z.string().min(1),
        quantity: z.number().int().positive("La cantidad debe ser mayor a 0"),
        priceType: z.nativeEnum(PriceType),
        unitPrice: z.number().nonnegative(),
        discountPct: z.number().min(0).max(100).optional(),
        // Ubicación de origen elegida al crear la orden. Se usa recién al
        // confirmar (ver confirmDispatchOrder), pero se captura acá porque es
        // donde existe el listado de ítems.
        locationId: z.string().min(1).optional(),
      })
    )
    .min(1, "Debes incluir al menos un ítem"),
});

// Solo relevante si paymentMethod=CONTRA_ENTREGA; si no, se ignora.
export const confirmDispatchOrderSchema = z.object({
  courierId: z.string().min(1).optional(),
  trackingNumber: z.string().max(100).optional(),
});

export const createPaymentSchema = z.object({
  amount: z.number().positive("El monto debe ser mayor a 0"),
  method: z.string().min(1, "El método de pago es obligatorio").max(50),
  paidAt: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
});

export const listDispatchOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(DispatchStatus).optional(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional(),
  buyerType: z.nativeEnum(BuyerType).optional(),
  wholesalerId: z.string().optional(),
  finalCustomerId: z.string().optional(),
  shippingProvince: z.string().optional(),
  dateFrom: z.coerce.date().optional(),
  dateTo: z.coerce.date().optional(),
});

export const accountsReceivableQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
