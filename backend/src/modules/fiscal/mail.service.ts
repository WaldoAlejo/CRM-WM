import nodemailer from "nodemailer";
import type { MailProfile } from "@prisma/client";
import type { Mailer, MailMessage } from "../../lib/mailer";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../utils/httpError";
import { decryptSecret } from "./secrets";

function secret(profile: MailProfile) {
  return profile.passwordEncrypted ? decryptSecret(profile.passwordEncrypted, `mail:${profile.id}`) : "";
}
function transport(profile: MailProfile) {
  return nodemailer.createTransport({ host: profile.host, port: profile.port,
    secure: profile.security === "TLS", requireTLS: profile.security === "STARTTLS",
    connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
    auth: profile.username ? { user: profile.username, pass: secret(profile) } : undefined,
    disableFileAccess: true, disableUrlAccess: true,
  });
}

// Resend (API HTTPS). Railway bloquea el SMTP saliente fuera del plan Pro, así
// que esta vía usa el puerto 443. La cuenta guarda la API key cifrada como
// contraseña; el remitente debe pertenecer a un dominio verificado en Resend.
const RESEND_API = "https://api.resend.com";
async function resend(profile: MailProfile, path: string, init: RequestInit = {}) {
  return fetch(`${RESEND_API}${path}`, { ...init, signal: AbortSignal.timeout(20000),
    headers: { Authorization: `Bearer ${secret(profile)}`, "Content-Type": "application/json", ...init.headers } });
}
async function verifyResend(profile: MailProfile) {
  const res = await resend(profile, "/domains");
  const body = await res.json().catch(() => ({})) as { name?: string; data?: { name: string; status: string }[] };
  // Una key con permiso "solo envío" no puede listar dominios pero es válida.
  if (res.status === 401 && body.name === "restricted_api_key") return { ok: true };
  if (!res.ok) throw badRequest("Resend rechazó la API key. Revisa que esté completa y vigente.");
  const domain = profile.fromEmail.split("@")[1]?.toLowerCase();
  const match = body.data?.find(d => d.name.toLowerCase() === domain);
  if (!match) throw badRequest(`El dominio ${domain} no está agregado en Resend. Agrégalo y verifícalo en Resend → Domains.`);
  if (match.status !== "verified") throw badRequest(`El dominio ${domain} todavía no está verificado en Resend (estado: ${match.status}). Revisa los registros DNS en GoDaddy.`);
  return { ok: true };
}
async function sendResend(profile: MailProfile, message: MailMessage) {
  const res = await resend(profile, "/emails", { method: "POST", body: JSON.stringify({
    from: `${profile.fromName.replace(/[<>"]/g, "")} <${profile.fromEmail}>`, to: [message.to], subject: message.subject,
    text: message.text, html: message.html, reply_to: profile.replyTo || undefined,
    attachments: message.attachments?.map(a => ({ filename: a.filename, content: a.content.toString("base64"), content_type: a.contentType })),
  }) });
  const body = await res.json().catch(() => ({})) as { id?: string; message?: string };
  if (!res.ok || !body.id) throw new Error(body.message ?? `Resend respondió ${res.status}`);
}

async function profileOrThrow(id: string) {
  const profile = await prisma.mailProfile.findUnique({ where: { id } });
  if (!profile) throw notFound("Cuenta de correo no encontrada");
  if (!profile.enabled) throw badRequest("La cuenta de correo está desactivada");
  return profile;
}
export async function verifyMail(id: string) {
  const profile = await profileOrThrow(id);
  if (profile.security === "RESEND") {
    try { return await verifyResend(profile); }
    catch (e) { throw e instanceof Error && "statusCode" in e ? e : badRequest("No se pudo conectar con Resend. Intenta de nuevo en unos minutos."); }
  }
  const smtp = transport(profile);
  try { await smtp.verify(); return { ok: true }; }
  catch { throw badRequest("No se pudo conectar o autenticar con el servidor SMTP. Revisa servidor, seguridad y credenciales. En Railway sin plan Pro el SMTP está bloqueado: usa Resend."); }
  finally { smtp.close(); }
}
export async function sendConfiguredMail(profileId: string, message: MailMessage, documentId?: string) {
  const profile = await profileOrThrow(profileId);
  const delivery = await prisma.mailDelivery.create({ data: { profileId, documentId, recipient: message.to, subject: message.subject, status: "PENDING" } });
  if (profile.security === "RESEND") {
    try {
      await sendResend(profile, message);
      await prisma.mailDelivery.update({ where: { id: delivery.id }, data: { status: "SENT" } });
    } catch (e) {
      const detail = e instanceof Error && e.message ? e.message.slice(0, 300) : "sin detalle";
      await prisma.mailDelivery.update({ where: { id: delivery.id }, data: { status: "FAILED", error: `Resend no aceptó el envío: ${detail}` } });
      throw badRequest(`Resend no aceptó el envío (${detail}). El comprobante conserva su estado fiscal.`);
    }
    return;
  }
  const smtp = transport(profile);
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
