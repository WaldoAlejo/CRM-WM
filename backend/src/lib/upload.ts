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
function createUploader(subfolder: "products" | "variants", paramName: string) {
  const storage = multer.diskStorage({
    destination: (req, _file, cb) => {
      const ownerId = req.params[paramName];
      const dir = path.join(UPLOADS_ROOT, subfolder, ownerId);
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
