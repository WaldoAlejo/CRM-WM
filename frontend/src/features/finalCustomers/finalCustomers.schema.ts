import { z } from "zod";
import { optionalEmail, optionalString } from "@/lib/zodHelpers";

// Espejo de backend/src/modules/finalCustomers/finalCustomers.schemas.ts.
export const finalCustomerFormSchema = z.object({
  fullName: z.string().min(1, "El nombre es obligatorio").max(200),
  idType: z.enum(["CEDULA", "PASAPORTE", "RUC"]),
  idNumber: optionalString(z.string().max(20)),
  phone: optionalString(z.string().max(30)),
  email: optionalEmail(),
  address: optionalString(z.string().max(300)),
});

export type FinalCustomerFormValues = z.infer<typeof finalCustomerFormSchema>;

export const finalCustomerDefaultValues: FinalCustomerFormValues = {
  fullName: "",
  idType: "CEDULA",
  idNumber: "",
  phone: "",
  email: "",
  address: "",
};
