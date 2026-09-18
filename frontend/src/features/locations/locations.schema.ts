import { z } from "zod";
import { optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/locations/locations.schemas.ts.
export const locationFormSchema = z.object({
  code: z.string().min(1, "El código es obligatorio").max(100),
  aisle: optionalString(z.string().max(100)),
  shelf: optionalString(z.string().max(100)),
  level: optionalString(z.string().max(100)),
});

export type LocationFormValues = z.infer<typeof locationFormSchema>;

export const locationDefaultValues: LocationFormValues = {
  code: "",
  aisle: "",
  shelf: "",
  level: "",
};
