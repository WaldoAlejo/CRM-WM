import { z } from "zod";
import { optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/warehouses/warehouses.schemas.ts.
export const warehouseFormSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  address: optionalString(z.string().max(500)),
});

export type WarehouseFormValues = z.infer<typeof warehouseFormSchema>;

export const warehouseDefaultValues: WarehouseFormValues = {
  name: "",
  address: "",
};
