import { Role } from "@prisma/client";
import { z } from "zod";

// Los correos se guardan en minúsculas: el login no distingue mayúsculas.
const email = z.string().trim().toLowerCase().pipe(z.string().email("Email inválido"));

export const createUserSchema = z.object({
  email,
  // Sin contraseña: se envía al correo un enlace para que el usuario la cree.
  password: z.union([z.literal(""), z.string().min(8, "La contraseña debe tener al menos 8 caracteres")]).optional(),
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  role: z.nativeEnum(Role),
});

// role/isActive van acá (no en un schema aparte) porque la restricción de
// "no podés tocar tu propio rol/estado" se valida en el service comparando
// contra el id del usuario autenticado, no con una forma de dato distinta.
export const updateUserSchema = z.object({
  email: email.optional(),
  name: z.string().min(1).max(200).optional(),
  role: z.nativeEnum(Role).optional(),
  isActive: z.boolean().optional(),
});
