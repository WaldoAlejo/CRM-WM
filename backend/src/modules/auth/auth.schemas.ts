import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.string().email("Email inválido")),
  password: z.string().min(1, "La contraseña es obligatoria"),
});

// Misma regla que al crear un usuario (users.schemas.ts).
export const newPasswordSchema = z.string().min(8, "La contraseña debe tener al menos 8 caracteres").max(200);

export const forgotPasswordSchema = z.object({ email: z.string().trim().max(254) });
export const passwordTokenSchema = z.object({ token: z.string().min(20).max(200) });
export const resetPasswordSchema = z.object({ token: z.string().min(20).max(200), password: newPasswordSchema });
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1, "Ingresa tu contraseña actual"), newPassword: newPasswordSchema });
