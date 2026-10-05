import { Request, Response } from "express";
import { changePasswordSchema, forgotPasswordSchema, loginSchema, passwordTokenSchema, resetPasswordSchema } from "./auth.schemas";
import { login } from "./auth.service";
import { changeOwnPassword, describePasswordToken, requestPasswordReset, resetPasswordWithToken } from "./passwordTokens";

export async function loginController(req: Request, res: Response) {
  const { email, password } = loginSchema.parse(req.body);
  const result = await login(email, password);
  res.json(result);
}

// Detrás del proxy de Railway req.ip es el proxy: se toma el primer
// X-Forwarded-For solo para el límite de intentos (no para autorizar nada).
const clientIp = (req: Request) => String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() || req.ip || "unknown";

// Respuesta idéntica exista o no la cuenta: no revela qué correos están registrados.
export async function forgotPasswordController(req: Request, res: Response) {
  const { email } = forgotPasswordSchema.parse(req.body);
  await requestPasswordReset(email, clientIp(req), req.headers.origin);
  res.json({ ok: true });
}

export async function describePasswordTokenController(req: Request, res: Response) {
  const { token } = passwordTokenSchema.parse(req.body);
  res.json(await describePasswordToken(token));
}

export async function resetPasswordController(req: Request, res: Response) {
  const { token, password } = resetPasswordSchema.parse(req.body);
  res.json(await resetPasswordWithToken(token, password));
}

export async function changePasswordController(req: Request, res: Response) {
  const { currentPassword, newPassword } = changePasswordSchema.parse(req.body);
  await changeOwnPassword(req.user!.id, currentPassword, newPassword);
  res.json({ ok: true });
}
