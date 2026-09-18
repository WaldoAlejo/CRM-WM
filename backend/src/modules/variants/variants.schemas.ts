import { z } from "zod";

// Objeto plano de pares clave-valor de texto: nunca vacío, nunca un arreglo,
// nunca anidado (z.record por sí solo aceptaría un arreglo, ya que en JS un
// arreglo también es un "objeto" — por eso el refine explícito).
const attributesSchema = z
  .record(z.string().min(1), z.string().min(1))
  .refine((val) => !Array.isArray(val), {
    message: "attributes debe ser un objeto plano, no un arreglo",
  })
  .refine((val) => Object.keys(val).length > 0, {
    message: "attributes no puede estar vacío",
  });

export const createVariantSchema = z.object({
  attributes: attributesSchema,
  sku: z.string().min(1).max(80).optional(), // si se omite, se autogenera
  barcode: z.string().max(50).optional(),
  warehouseLocation: z.string().max(200).optional(),
  minStock: z.number().int().nonnegative().optional(),
  weightKg: z.number().positive().optional(),
  dimensionsCm: z.string().max(50).optional(),
  costPriceCNY: z.number().nonnegative().optional(),
  wholesalePrice: z.number().nonnegative().optional(),
  wholesaleDiscountPct: z.number().min(0).max(100).optional(),
  retailPrice: z.number().nonnegative().optional(),
  retailDiscountPct: z.number().min(0).max(100).optional(),
  // Permite crear una variante aunque el producto padre esté DISCONTINUED
  // (ej: se está reactivando la línea). Ver regla de negocio 5.
  force: z.boolean().optional().default(false),
});

export const updateVariantSchema = z.object({
  attributes: attributesSchema.optional(), // reemplaza el objeto completo, no hace merge parcial
  sku: z.string().min(1).max(80).optional(),
  barcode: z.string().max(50).nullable().optional(),
  warehouseLocation: z.string().max(200).nullable().optional(),
  minStock: z.number().int().nonnegative().nullable().optional(),
  weightKg: z.number().positive().nullable().optional(),
  dimensionsCm: z.string().max(50).nullable().optional(),
  costPriceCNY: z.number().nonnegative().nullable().optional(),
  wholesalePrice: z.number().nonnegative().nullable().optional(),
  wholesaleDiscountPct: z.number().min(0).max(100).nullable().optional(),
  retailPrice: z.number().nonnegative().nullable().optional(),
  retailDiscountPct: z.number().min(0).max(100).nullable().optional(),
  isActive: z.boolean().optional(),
});
