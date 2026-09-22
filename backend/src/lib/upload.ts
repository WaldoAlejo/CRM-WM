// Almacenamiento de imágenes de productos/variantes.
//
// TODO: hoy se guardan en disco local (carpeta /uploads en la raíz del
// backend) y se sirven como archivos estáticos desde app.ts. Cuando se defina
// el proveedor (S3, Cloudinary, etc.), lo único que debería cambiar es este
// archivo: los services/controllers solo conocen la URL pública que devuelve
// `buildPublicUrl`, no cómo ni dónde se guardó el archivo.
import { randomUUID } from "crypto";
import fs from "fs";
import multer from "multer";
import path from "path";

export const UPLOADS_ROOT = path.join(process.cwd(), "uploads");
// Almacenamiento PRIVADO (comprobantes de pago): a propósito FUERA de
// UPLOADS_ROOT, porque app.ts sirve esa carpeta completa con express.static
// SIN autenticación. Nada de acá se sirve como estático: solo por endpoints
// autenticados (ver dispatchOrders.controller.ts).
export const PRIVATE_UPLOADS_ROOT = path.join(process.cwd(), "uploads-private");

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB

// Error propio (no de multer) para poder distinguirlo en errorHandler.ts y
// devolver un 400 con mensaje claro en vez de un 500 genérico.
export class UnsupportedFileTypeError extends Error {}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

// `paramName` es explícito (no se adivina entre varios posibles) para que
// quede claro, leyendo esta función, de dónde sale el id del dueño de la
// imagen en cada caso.
function createUploader(subfolder: "products" | "variants" | "payments", paramName: string, root = UPLOADS_ROOT) {
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const ownerId = req.params[paramName];
      const dir = path.join(root, subfolder, ownerId);
      ensureDir(dir);
      cb(null, dir);
    },
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${randomUUID()}${ext}`);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE_BYTES },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return cb(new UnsupportedFileTypeError("Formato de imagen no permitido (solo JPEG, PNG o WEBP)"));
      }
      cb(null, true);
    },
  });
}

export const uploadProductImage = createUploader("products", "productId");
export const uploadVariantImage = createUploader("variants", "variantId");
// Comprobante de pago: mismo multer/mismos límites (JPEG/PNG/WEBP, 5 MB) que las
// imágenes de producto, pero en el almacenamiento privado y por orden (:id).
export const uploadPaymentProof = createUploader("payments", "id", PRIVATE_UPLOADS_ROOT);

// Ruta relativa (la que se guarda en BD) de un archivo ya subido al almacenamiento
// privado, p. ej. "payments/<orderId>/<uuid>.jpg".
export function privateRelativePath(file: { path: string }): string {
  return path.relative(PRIVATE_UPLOADS_ROOT, file.path).split(path.sep).join("/");
}

// Ruta absoluta en disco de un archivo privado, validando que no se salga de la
// raíz privada (la ruta viene de la BD, pero nunca se confía a ciegas).
export function resolvePrivatePath(relative: string): string {
  const full = path.resolve(PRIVATE_UPLOADS_ROOT, relative);
  if (!full.startsWith(PRIVATE_UPLOADS_ROOT + path.sep)) throw new Error("Ruta privada inválida");
  return full;
}

// Descarte de un archivo privado que se subió pero cuyo registro NO llegó a
// crearse (validación fallida, orden inexistente, error de BD). Solo para ese
// caso: un comprobante ya asociado a un pago nunca se borra.
export function discardUploadedFile(file: { path: string } | undefined) {
  if (!file) return;
  fs.unlink(file.path, (err) => {
    if (err && err.code !== "ENOENT") console.error(`No se pudo descartar ${file.path}:`, err.message);
  });
}

// Convierte una ruta en disco a la URL pública que sirve express.static.
export function buildPublicUrl(
  subfolder: "products" | "variants",
  ownerId: string,
  filename: string
): string {
  return `/uploads/${subfolder}/${ownerId}/${filename}`;
}

// Borrado "best effort": si el archivo ya no está en disco (ENOENT) no es un
// error real. Cualquier otro problema se loguea pero nunca bloquea la
// operación que lo llamó (borrar el registro en BD es lo importante).
export function deleteFileSafely(publicUrl: string) {
  const relative = publicUrl.replace(/^\/uploads\//, "");
  const filePath = path.join(UPLOADS_ROOT, relative);
  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      console.error(`No se pudo borrar el archivo ${filePath}:`, err.message);
    }
  });
}
