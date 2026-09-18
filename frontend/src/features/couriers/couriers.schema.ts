import { z } from "zod";
import { optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/couriers/couriers.schemas.ts.
export const courierFormSchema = z.object({
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  contactInfo: optionalString(z.string().max(300)),
});

export type CourierFormValues = z.infer<typeof courierFormSchema>;

export const courierDefaultValues: CourierFormValues = {
  name: "",
  contactInfo: "",
};
