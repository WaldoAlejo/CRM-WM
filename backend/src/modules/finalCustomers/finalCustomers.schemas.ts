import { IdType } from "@prisma/client";
import { z } from "zod";

export const createFinalCustomerSchema = z.object({
  fullName: z.string().min(1, "El nombre es obligatorio").max(200),
  idType: z.nativeEnum(IdType).default(IdType.CEDULA),
  idNumber: z.string().max(20).optional(),
  phone: z.string().max(30).optional(),
  email: z.string().email("Email inválido").optional(),
  address: z.string().max(300).optional(),
});

export const updateFinalCustomerSchema = createFinalCustomerSchema.partial();

export const listFinalCustomersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().optional(),
});
