import nodemailer from "nodemailer";
import type { MailProfile } from "@prisma/client";
import type { Mailer, MailMessage } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../utils/httpError";
import { decryptSecret } from "./secrets";

function transport(profile: MailProfile) {
  return nodemailer.createTransport({ host: profile.host, port: profile.port,
    secure: profile.security === "TLS", requireTLS: profile.security === "STARTTLS",
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    auth: profile.username ? { user: profile.username, pass: profile.passwordEncrypted ? decryptSecret(profile.passwordEncrypted, `mail:${profile.id}`) : "" } : undefined,
    disableFileAccess: true, disableUrlAccess: true,
  });
}
async function profileOrThrow(id: string) {
  const profile = await prisma.mailProfile.findUnique({ where: { id } });
  if (!profile) throw notFound("Cuenta de correo no encontrada");
  if (!profile.enabled) throw badRequest("La cuenta de correo está desactivada");
  return profile;
}
export async function verifyMail(id: string) {
  const profile = await profileOrThrow(id);
  const smtp = transport(profile);
  try { await smtp.verify(); return { ok: true }; }
  catch { throw badRequest("No se pudo conectar o autenticar con el servidor SMTP. Revisa servidor, seguridad y credenciales."); }
  finally { smtp.close(); }
}
export async function sendConfiguredMail(profileId: string, message: MailMessage, documentId?: string) {
  const profile = await profileOrThrow(profileId);
  const smtp = transport(profile);
  const delivery = await prisma.mailDelivery.create({ data: { profileId, documentId, recipient: message.to, subject: message.subject, status: "PENDING" } });
  try {
    const result = await smtp.sendMail({ ...message, from: { name: profile.fromName, address: profile.fromEmail }, replyTo: profile.replyTo || undefined });
    if (!result.accepted?.length) throw new Error();
    await prisma.mailDelivery.update({ where: { id: delivery.id }, data: { status: "SENT" } });
  } catch {
    await prisma.mailDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", error: "El envío no pudo confirmarse con SMTP. Revisa la cuenta antes de reintentar." } });
    throw badRequest("El envío no pudo confirmarse con SMTP. El comprobante conserva su estado fiscal.");
  } finally { smtp.close(); }
}
export async function configuredMailer(id: string): Promise<Mailer | null> {
  const profile = await prisma.mailProfile.findUnique({ where: { id } });
  if (!profile?.enabled) return null;
  return { send: message => sendConfiguredMail(id, message) };
}
