import { z } from "zod";
import { optionalNumber, optionalString } from "@/lib/zodHelpers";

// Un ítem del borrador de la orden: además de lo que el backend espera
// (variantId/quantity/priceType/unitPrice/discountPct), guarda sku/label
// (para mensajes de error y para pintar la fila sin tener que re-consultar)
// y availableStockAtAdd — la foto de stock disponible que ya vino en la
// misma respuesta de búsqueda que se usó para agregar la línea (ver
// VariantSearchAdd). Ninguno de estos 3 extra se manda al backend.
export const dispatchOrderItemSchema = z.object({
  variantId: z.string().min(1),
  sku: z.string(),
  label: z.string().nullable(),
  quantity: z.coerce.number().int().positive("La cantidad debe ser mayor a 0"),
  priceType: z.enum(["MAYORISTA", "PVP"]),
  costBased: z.boolean().optional(),
  costAtAdd: z.number().positive().optional(),
  markupPct: optionalNumber(z.number().min(0).max(10000).multipleOf(0.01)),
  unitPrice: z.coerce.number().nonnegative("El precio no puede ser negativo"),
  discountPct: optionalNumber(z.number().min(0).max(100, "Debe estar entre 0 y 100")),
  availableStockAtAdd: z.number(),
  // Ubicación de origen (opcional): de dónde sale físicamente este ítem.
  locationId: optionalString(z.string().min(1)),
}).refine(item => !item.costBased || (item.markupPct !== undefined && item.costAtAdd !== undefined), { message: "Ingresa el incremento negociado sobre el costo real", path: ["markupPct"] });

export type DispatchOrderItemFormValues = z.infer<typeof dispatchOrderItemSchema>;

// Espejo del bloqueo de variantId repetido que ya hace
// dispatchOrders.service.ts (createDispatchOrder) — acá evita el viaje
// redondo de "guardar → 400", igual que el bloqueo de claves de atributo
// repetidas en variantes.
const itemsArraySchema = z
  .array(dispatchOrderItemSchema)
  .min(1, "Agregá al menos un ítem")
  .superRefine((items, ctx) => {
    const seenAt = new Map<string, number>();
    items.forEach((item, index) => {
      if (seenAt.has(item.variantId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${item.sku} ya está en la orden — combiná las cantidades en una sola línea.`,
          path: [index, "variantId"],
        });
      } else {
        seenAt.set(item.variantId, index);
      }
    });
  });

// Espejo de backend/src/modules/dispatchOrders/dispatchOrders.schemas.ts
// (createDispatchOrderSchema), MÁS las 3 reglas de negocio que ahí se
// validan en el service (no en el schema) y acá se resuelven ANTES del
// submit: exactamente un comprador según buyerType, crédito exclusivo de
// mayoristas, y creditDays obligatorio si paymentMethod=CREDITO.
export const dispatchOrderFormSchema = z
  .object({
    buyerType: z.enum(["MAYORISTA", "CLIENTE_FINAL"]),
    wholesalerId: optionalString(z.string().min(1)),
    finalCustomerId: optionalString(z.string().min(1)),
    shippingProvince: z.string().min(1, "La provincia de despacho es obligatoria"),
    shippingCity: z.string().min(1, "La ciudad de despacho es obligatoria"),
    paymentMethod: z.enum(["CONTADO", "CREDITO", "CONTRA_ENTREGA"]),
    creditDays: optionalNumber(z.number().int().positive()),
    notes: optionalString(z.string().max(2000)),
    items: itemsArraySchema,
  })
  .superRefine((values, ctx) => {
    if (values.buyerType === "MAYORISTA" && !values.wholesalerId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Elegí un mayorista", path: ["wholesalerId"] });
    }
    if (values.buyerType === "CLIENTE_FINAL" && !values.finalCustomerId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Elegí un cliente final",
        path: ["finalCustomerId"],
      });
    }
    if (values.paymentMethod === "CREDITO" && values.buyerType === "CLIENTE_FINAL") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "El crédito solo está disponible para compradores tipo mayorista",
        path: ["paymentMethod"],
      });
    }
    if (values.paymentMethod === "CREDITO" && !values.creditDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Los días de crédito son obligatorios para pago a crédito",
        path: ["creditDays"],
      });
    }
  });

export type DispatchOrderFormValues = z.infer<typeof dispatchOrderFormSchema>;

export const dispatchOrderDefaultValues: DispatchOrderFormValues = {
  buyerType: "CLIENTE_FINAL",
  wholesalerId: undefined,
  finalCustomerId: undefined,
  shippingProvince: "",
  shippingCity: "",
  paymentMethod: "CONTADO",
  creditDays: undefined,
  notes: "",
  items: [],
};

// Espejo de confirmDispatchOrderSchema — pero acá courierId SÍ es
// obligatorio: este schema solo se usa cuando paymentMethod=CONTRA_ENTREGA
// (el único caso en que el backend lo exige), así que ConfirmOrderDialog no
// necesita duplicar esa condición en la validación.
export const confirmContraEntregaSchema = z.object({
  courierId: z.string().min(1, "Elegí un courier"),
  trackingNumber: optionalString(z.string().max(100)),
});

export type ConfirmContraEntregaFormValues = z.infer<typeof confirmContraEntregaSchema>;

// Espejo de createPaymentSchema.
export const paymentFormSchema = z.object({
  amount: z.coerce.number().positive("El monto debe ser mayor a 0"),
  method: z.string().min(1, "El método de pago es obligatorio").max(50),
  paidAt: optionalString(z.string()),
  notes: optionalString(z.string().max(500)),
});

export type PaymentFormValues = z.infer<typeof paymentFormSchema>;

export const paymentDefaultValues: PaymentFormValues = {
  amount: 0,
  method: "",
  paidAt: "",
  notes: "",
};
