import { z } from "zod";
import { optionalNumber, optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/warehouses/warehouses.schemas.ts.
export const warehouseFormSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  address: optionalString(z.string().max(500)),
  capacity: optionalNumber(z.number().int().nonnegative("No puede ser negativo")),
  phone: optionalString(z.string().max(30)),
  notes: optionalString(z.string().max(2000)),
  // "" = sin responsable (el Select no tiene forma nativa de representar
  // "sin selección" con un value vacío real) — WarehouseFormDialog lo
  // traduce a null/undefined al armar el payload, nunca lo manda tal cual.
  // Opcional (no solo en el form): el payload real a la API también puede
  // omitirlo por completo (crear una bodega sin responsable).
  managerId: z.string().optional(),
});

export type WarehouseFormValues = z.infer<typeof warehouseFormSchema>;

export const warehouseDefaultValues: WarehouseFormValues = {
  name: "",
  address: "",
  capacity: undefined,
  phone: "",
  notes: "",
  managerId: "",
};
