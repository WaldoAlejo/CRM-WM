import { Role } from "@prisma/client";
import { z } from "zod";

export const createUserSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  role: z.nativeEnum(Role),
});

// role/isActive van acá (no en un schema aparte) porque la restricción de
// "no podés tocar tu propio rol/estado" se valida en el service comparando
// contra el id del usuario autenticado, no con una forma de dato distinta.
export const updateUserSchema = z.object({
  email: z.string().email("Email inválido").optional(),
  name: z.string().min(1).max(200).optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
});
