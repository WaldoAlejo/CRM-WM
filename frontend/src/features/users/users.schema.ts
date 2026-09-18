import { z } from "zod";

// Espejo de backend/src/modules/users/users.schemas.ts (createUserSchema).
export const createUserFormSchema = z.object({
  email: z.string().email("Email inválido"),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres"),
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  role: z.enum(["ADMIN", "OPERATOR"]),
});

export type CreateUserFormValues = z.infer<typeof createUserFormSchema>;

export const createUserDefaultValues: CreateUserFormValues = {
  email: "",
  password: "",
  name: "",
  role: "OPERATOR",
};

// Espejo de updateUserSchema — sin password: la contraseña se cambia solo
// vía POST /users/:id/reset-password (ResetPasswordDialog), nunca desde este
// formulario.
export const editUserFormSchema = z.object({
  email: z.string().email("Email inválido"),
  name: z.string().min(1, "El nombre es obligatorio").max(200),
  role: z.enum(["ADMIN", "OPERATOR"]),
});

export type EditUserFormValues = z.infer<typeof editUserFormSchema>;
