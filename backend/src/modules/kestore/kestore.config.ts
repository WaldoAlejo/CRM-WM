import { createHmac, timingSafeEqual } from "crypto";

// Integración con Kestore (ver INTEGRACION_KESTORE.md en la raíz). Misma firma que el
// webhook de Siglo 21 que Kestore ya recibe: HMAC-SHA256 con un secreto
// compartido sobre "timestamp.cuerpo", en hexadecimal con prefijo "sha256=".
// Las peticiones con más de 5 minutos de diferencia se rechazan para que una
// petición capturada no pueda repetirse.
export const KESTORE_TIMESTAMP_HEADER = "x-crm-timestamp";
export const KESTORE_SIGNATURE_HEADER = "x-crm-signature";
export const MAX_CLOCK_SKEW_SECONDS = 300;

export function kestoreSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const secret = env.KESTORE_WEBHOOK_SECRET?.trim();
  return secret && secret.length >= 32 ? secret : null;
}

export function kestoreWebhookUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const url = env.KESTORE_WEBHOOK_URL?.trim();
  return url && /^https?:\/\//.test(url) ? url : null;
}

export function signKestorePayload(secret: string, timestamp: string, body: Buffer | string): string {
  return "sha256=" + createHmac("sha256", secret).update(`${timestamp}.`).update(body).digest("hex");
}

export function isValidKestoreSignature(secret: string, timestamp: string | undefined, signature: string | undefined, body: Buffer, now = Date.now()) {
  if (!timestamp || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(now / 1000) - Number(timestamp)) > MAX_CLOCK_SKEW_SECONDS) return false;
  const supplied = Buffer.from((signature ?? "").trim().replace(/^sha256=/i, ""), "hex");
  const expected = Buffer.from(signKestorePayload(secret, timestamp, body).slice(7), "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
