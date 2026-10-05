// Creación y recuperación de contraseñas por correo con enlaces de un solo uso.
// Solo se guarda el SHA-256 del token; el valor en claro existe únicamente en el
// enlace enviado. Al usarse un enlace se invalidan todos los pendientes del usuario.
import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { getConfiguredMailer } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict } from "../../utils/httpError";

export type PasswordTokenPurpose = "RESET" | "INVITE";
const TTL_MINUTES: Record<PasswordTokenPurpose, number> = { RESET: 60, INVITE: 72 * 60 };

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

// El enlace apunta al frontend. APP_URL lo fija explícitamente; si no existe se
// usa el Origin de la petición, pero solo si es uno de los orígenes de CORS
// (nunca un Origin arbitrario enviado por un tercero).
export function resolveAppUrl(origin: string | undefined): string | null {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, "");
  if (!origin) return null;
  const allowed = (process.env.CORS_ORIGIN ?? "").split(",").map(o => o.trim()).filter(Boolean);
  if (allowed.length ? allowed.includes(origin) : process.env.NODE_ENV !== "production") return origin.replace(/\/+$/, "");
  return null;
}

// Límite simple en memoria contra abuso del formulario público (un solo proceso).
const attempts = new Map<string, number[]>();
function allow(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const recent = (attempts.get(key) ?? []).filter(t => now - t < windowMs);
  if (recent.length >= max) { attempts.set(key, recent); return false; }
  recent.push(now); attempts.set(key, recent);
  return true;
}
export function resetRateLimitsForTests() { attempts.clear(); }

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

async function sendLink(user: { id: string; email: string; name: string }, purpose: PasswordTokenPurpose, appUrl: string) {
  const mailer = await getConfiguredMailer();
  if (!mailer) throw conflict("No hay una cuenta de correo configurada para enviar el enlace. Configúrala en Configuración → Correo.");
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_MINUTES[purpose] * 60_000);
  const created = await prisma.passwordToken.create({ data: { userId: user.id, tokenHash: hashToken(token), purpose, expiresAt } });
  const link = `${appUrl}/reset-password?token=${token}`;
  const invite = purpose === "INVITE";
  const subject = invite ? "Tu acceso a WM / Kestore" : "Recupera tu contraseña de WM / Kestore";
  const intro = invite
    ? `Se creó tu acceso a WM / Kestore con el usuario ${user.email}. Crea tu contraseña con este enlace (válido por 72 horas):`
    : `Recibimos una solicitud para cambiar la contraseña de ${user.email}. Usa este enlace (válido por 1 hora):`;
  const outro = invite ? "Si no esperabas este correo, ignóralo." : "Si no lo pediste, ignora este correo: tu contraseña actual sigue funcionando.";
  try {
    await mailer.send({
      to: user.email, subject,
      text: `Hola ${user.name}:\n\n${intro}\n\n${link}\n\n${outro}`,
      html: `<p>Hola ${escapeHtml(user.name)}:</p><p>${escapeHtml(intro)}</p><p><a href="${link}" style="display:inline-block;padding:10px 18px;background:#111;color:#fff;border-radius:6px;text-decoration:none">${invite ? "Crear mi contraseña" : "Cambiar mi contraseña"}</a></p><p style="font-size:12px;color:#666">Si el botón no funciona, copia este enlace: ${link}</p><p style="font-size:12px;color:#666">${escapeHtml(outro)}</p>`,
    });
  } catch (error) {
    // Un enlace que no llegó no debe quedar utilizable.
    await prisma.passwordToken.delete({ where: { id: created.id } }).catch(() => undefined);
    throw error;
  }
}

/** Formulario público "olvidé mi contraseña": nunca revela si la cuenta existe. */
export async function requestPasswordReset(email: string, ip: string, origin: string | undefined) {
  const normalized = normalizeEmail(email);
  if (!allow(`ip:${ip}`, 20, 15 * 60_000) || !allow(`email:${normalized}`, 3, 15 * 60_000)) return;
  const appUrl = resolveAppUrl(origin);
  const user = await prisma.user.findFirst({ where: { email: { equals: normalized, mode: "insensitive" }, isActive: true } });
  if (!user || !appUrl) return;
  try { await sendLink(user, "RESET", appUrl); }
  catch (error) { console.error("[password-reset] no se pudo enviar el enlace:", error instanceof Error ? error.message : error); }
}

/** Enlace de acceso enviado por un administrador (invitación o reseteo asistido). */
export async function sendAccessLink(userId: string, purpose: PasswordTokenPurpose, origin: string | undefined) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.isActive) throw conflict("El usuario está inactivo. Actívalo antes de enviarle un enlace de acceso.");
  const appUrl = resolveAppUrl(origin);
  if (!appUrl) throw conflict("Falta APP_URL en el servidor para armar el enlace de acceso.");
  await sendLink(user, purpose, appUrl);
  return { sentTo: user.email };
}

async function usableToken(token: string) {
  const row = await prisma.passwordToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.usedAt || row.expiresAt < new Date() || !row.user.isActive) {
    throw badRequest("El enlace no es válido o ya venció. Solicita uno nuevo desde «¿Olvidaste tu contraseña?».");
  }
  return row;
}

export async function describePasswordToken(token: string) {
  const row = await usableToken(token);
  return { email: row.user.email, name: row.user.name, purpose: row.purpose as PasswordTokenPurpose };
}

export async function resetPasswordWithToken(token: string, password: string) {
  const row = await usableToken(token);
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.$transaction(async tx => {
    // updateMany condicionado: dos envíos simultáneos del mismo enlace no lo usan dos veces.
    const claimed = await tx.passwordToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw badRequest("El enlace ya fue utilizado.");
    await tx.user.update({ where: { id: row.userId }, data: { passwordHash } });
    await tx.passwordToken.updateMany({ where: { userId: row.userId, usedAt: null }, data: { usedAt: new Date() } });
    await tx.auditLog.create({ data: { entityType: "UserPassword", entityId: row.userId, action: "UPDATE", changes: { via: row.purpose }, performedById: row.userId } });
  });
  return { email: row.user.email };
}

export async function changeOwnPassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw badRequest("La contraseña actual no es correcta.", { field: "currentPassword" });
  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
    prisma.passwordToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: new Date() } }),
    prisma.auditLog.create({ data: { entityType: "UserPassword", entityId: userId, action: "UPDATE", changes: { via: "SELF" }, performedById: userId } }),
  ]);
}
