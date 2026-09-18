import { z } from "zod";
import { optionalNumber, optionalString } from "@/lib/zodHelpers";

export const attributePairSchema = z.object({
  key: z.string().min(1, "La clave es obligatoria"),
  value: z.string().min(1, "El valor es obligatorio"),
});

export type AttributePair = z.infer<typeof attributePairSchema>;

// Espejo del refine real del backend (objeto plano, nunca vacío — ver
// backend/src/modules/variants/variants.schemas.ts) MÁS una validación que
// el backend no necesita: un objeto JS no puede tener 2 keys iguales, así
// que ahí el problema de "Color" y "color" en dos filas nunca se manifiesta
// — pero si no lo bloqueamos acá, pairsToAttributes() las pisaría en
// silencio al armar el objeto final (la segunda gana, la primera desaparece
// sin aviso).
const attributePairsSchema = z
  .array(attributePairSchema)
  .min(1, "Agregá al menos un atributo")
  .superRefine((pairs, ctx) => {
    const seenAt = new Map<string, number>();
    pairs.forEach((pair, index) => {
      const normalized = pair.key.trim().toLowerCase();
      if (!normalized) return; // el .min(1) de "key" ya lo marca
      if (seenAt.has(normalized)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `La clave "${pair.key}" está repetida (no distingue mayúsculas/minúsculas).`,
          path: [index, "key"],
        });
      } else {
        seenAt.set(normalized, index);
      }
    });
  });

// Espejo de backend/src/modules/variants/variants.schemas.ts. `force` vive
// acá aunque solo aplique a CREATE (updateVariantSchema no lo tiene) —
// VariantFormDialog decide si lo muestra/manda según el modo.
export const variantFormSchema = z.object({
  attributePairs: attributePairsSchema,
  sku: optionalString(z.string().min(1).max(80)),
  barcode: optionalString(z.string().max(50)),
  warehouseLocation: optionalString(z.string().max(200)),
  minStock: optionalNumber(z.number().int().nonnegative("No puede ser negativo")),
  weightKg: optionalNumber(z.number().positive("Debe ser mayor a 0")),
  dimensionsCm: optionalString(z.string().max(50)),
  costPriceCNY: optionalNumber(z.number().nonnegative("No puede ser negativo")),
  wholesalePrice: optionalNumber(z.number().nonnegative("No puede ser negativo")),
  wholesaleDiscountPct: optionalNumber(z.number().min(0).max(100, "Debe estar entre 0 y 100")),
  retailPrice: optionalNumber(z.number().nonnegative("No puede ser negativo")),
  retailDiscountPct: optionalNumber(z.number().min(0).max(100, "Debe estar entre 0 y 100")),
  force: z.boolean(),
});

export type VariantFormValues = z.infer<typeof variantFormSchema>;

export const variantDefaultValues: VariantFormValues = {
  attributePairs: [{ key: "", value: "" }],
  sku: "",
  barcode: "",
  warehouseLocation: "",
  minStock: undefined,
  weightKg: undefined,
  dimensionsCm: "",
  costPriceCNY: undefined,
  wholesalePrice: undefined,
  wholesaleDiscountPct: undefined,
  retailPrice: undefined,
  retailDiscountPct: undefined,
  force: false,
};

export function attributesToPairs(attributes: Record<string, string>): AttributePair[] {
  const entries = Object.entries(attributes);
  return entries.length > 0 ? entries.map(([key, value]) => ({ key, value })) : [{ key: "", value: "" }];
}

export function pairsToAttributes(pairs: AttributePair[]): Record<string, string> {
  return Object.fromEntries(pairs.map((p) => [p.key.trim(), p.value.trim()]));
}
