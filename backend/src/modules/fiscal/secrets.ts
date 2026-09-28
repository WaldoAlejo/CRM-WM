import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { HttpError } from "../../utils/httpError";

function key() {
  const value = process.env.SETTINGS_ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new HttpError(503, "Falta configurar SETTINGS_ENCRYPTION_KEY (32 bytes hexadecimales) en el servidor.");
  return Buffer.from(value, "hex");
}
export function encryptionReady() {
  return /^[a-f0-9]{64}$/i.test(process.env.SETTINGS_ENCRYPTION_KEY ?? "");
}
export function encryptSecret(value: string, context: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(context));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}
export function decryptSecret(value: string, context: string) {
  try {
    const [version, iv, tag, data] = value.split(".");
    if (version !== "v1") throw new Error();
    const cipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([cipher.update(Buffer.from(data, "base64")), cipher.final()]).toString("utf8");
  } catch { throw new HttpError(503, "No se pudo abrir la credencial protegida. Revisa la clave de cifrado del servidor."); }
}
