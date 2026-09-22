// Envío de correo por SMTP (nodemailer). El proyecto no tenía ningún servicio de
// email: esta es la única puerta de salida de correos. Las credenciales vienen
// SIEMPRE de variables de entorno (ver .env.example); sin SMTP_HOST/MAIL_FROM el
// sistema funciona igual y simplemente no envía (getMailer() devuelve null).
import nodemailer from "nodemailer";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export function isMailConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.SMTP_HOST && env.MAIL_FROM);
}

let cached: Mailer | null = null;
// Solo para tests: permite inyectar un mailer falso (nunca se envía correo real).
let override: Mailer | null | undefined;
export function setMailerForTests(mailer: Mailer | null | undefined) {
  override = mailer;
}

export function getMailer(env: NodeJS.ProcessEnv = process.env): Mailer | null {
  if (override !== undefined) return override;
  if (!isMailConfigured(env)) return null;
  if (cached) return cached;

  const port = Number(env.SMTP_PORT ?? 587);
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port,
    // 465 = TLS implícito; 587/25 = STARTTLS (secure=false). Sobrescribible.
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
    ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? "" } } : {}),
  });
  const from = env.MAIL_FROM!;

  cached = {
    async send(message) {
      await transport.sendMail({ from, ...message });
    },
  };
  return cached;
}
