import { z } from "zod";
import { optionalNumber, optionalString } from "@/lib/zodHelpers";
import { cartonPackagingSchema } from './cartonPackaging.schema';

// Espejo de receiveStockSchema (backend/importBatches.schemas.ts). sku/label/
// productName son solo para pintar la fila y los mensajes de error, no se
// mandan al backend.
export const receiveLineSchema = z.object({
  packaging: cartonPackagingSchema.optional(),
  variantId: z.string().min(1),
  sku: z.string(),
  label: z.string().nullable(),
  productName: z.string(),
  quantity: z.coerce.number().int("Debe ser un entero").positive("La cantidad debe ser mayor a 0"),
  volumeCbm: z.coerce.number().positive("Ingresa los CBM totales de esta línea").max(999999).multipleOf(0.000001),
  unitCost: z.coerce.number().nonnegative("El costo unitario no puede ser negativo"),
  locationId: z.string({ error: "Selecciona la bodega y ubicación de destino" }).trim().min(1, "Selecciona la bodega y ubicación de destino"),
  notes: optionalString(z.string().max(500)),
}).refine(line => !line.packaging || line.quantity === line.packaging.cartonCount * line.packaging.unitsPerCarton, { path: ['quantity'], message: 'La cantidad debe coincidir con cartones × unidades por cartón' });

export type ReceiveLineFormValues = z.infer<typeof receiveLineSchema>;

const linesSchema = z
  .array(receiveLineSchema)
  .min(1, "Agregá al menos una línea")
  .superRefine((lines, ctx) => {
    const seenAt = new Map<string, number>();
    lines.forEach((line, index) => {
      if (seenAt.has(line.variantId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${line.sku} ya está en el ingreso — combiná las cantidades en una sola línea.`,
          path: [index, "variantId"],
        });
      } else {
        seenAt.set(line.variantId, index);
      }
    });
  });

// Solo las líneas — lo usa la pantalla de "recibir más mercadería" de un lote
// ya creado.
export const receiveFormSchema = z.object({ lines: linesSchema });
export type ReceiveFormValues = z.infer<typeof receiveFormSchema>;
export const receiveFormDefaultValues: ReceiveFormValues = { lines: [] };

// Espejo de createImportBatchSchema + las líneas de recepción. Los 3 costos
// solo existen para ADMIN (el backend responde 403 si OPERATOR los manda) —
// la página simplemente no los renderiza para OPERATOR, quedan undefined.
export const createImportBatchFormSchema = z.object({
  containerType: z.enum(["20", "40", "40HC", "LCL"]),
  containerCbm: z.coerce.number().positive("Ingresa los CBM contratados del lote").max(999999).multipleOf(0.000001),
  reference: z.string().min(1, "La referencia/contenedor es obligatoria").max(100),
  supplierId: optionalString(z.string().min(1)),
  arrivalDate: z.string().min(1, "La fecha de llegada es obligatoria"),
  notes: optionalString(z.string().max(2000)),
  freightCost: optionalNumber(z.number().nonnegative("No puede ser negativo")),
  customsCost: optionalNumber(z.number().nonnegative("No puede ser negativo")),
  otherCosts: optionalNumber(z.number().nonnegative("No puede ser negativo")),
  lines: linesSchema,
}).superRefine((values, ctx) => {
  if (values.lines.reduce((sum, line) => sum + line.volumeCbm, 0) - values.containerCbm > 0.0000001) {
    ctx.addIssue({ code: "custom", path: ["lines"], message: "Los CBM de las líneas superan el volumen contratado del lote" });
  }
});

export type CreateImportBatchFormValues = z.infer<typeof createImportBatchFormSchema>;

export function createImportBatchDefaultValues(): CreateImportBatchFormValues {
  return {
    reference: "",
    containerType: "40",
    containerCbm: 0,
    supplierId: undefined,
    arrivalDate: new Date().toISOString().slice(0, 10),
    notes: "",
    freightCost: undefined,
    customsCost: undefined,
    otherCosts: undefined,
    lines: [],
  };
}
