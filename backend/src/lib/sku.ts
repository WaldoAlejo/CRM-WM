// Utilidades para derivar el SKU y el label de una variante a partir de sus
// `attributes` (JSON flexible, ver comentario en ProductVariant del schema).
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

// Rango Unicode de los "diacríticos combinantes" (los acentos/tildes que
// `.normalize("NFD")` separa de su letra base). Se arma a partir de los
// códigos hexadecimales en vez de escribir el rango directo en un regex
// literal, para que en el archivo quede como texto ASCII plano y legible
// (nada de caracteres invisibles pegados en el código fuente).
const COMBINING_MARKS_PATTERN = new RegExp(
  `[${String.fromCharCode(0x0300)}-${String.fromCharCode(0x036f)}]`,
  "g"
);

// "Acero Inoxidable" -> "ACEROINOXIDABLE", "5L" -> "5L", "Ñandú" -> "NANDU"
function sanitizeAttributeValue(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS_PATTERN, "") // quita tildes/diacríticos
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, ""); // deja solo letras/números
}

// Concatena los valores de attributes en el orden en que fueron ingresados
// (el orden de las claves de un objeto JS/JSON es el de inserción), separados
// por " / ". Ej: { color: "Negro", capacidad: "5L" } -> "Negro / 5L".
// Es la única función que arma `label`: nunca se acepta como input directo.
export function buildLabel(attributes: Record<string, string>): string {
  return Object.values(attributes).join(" / ");
}

// Cada atributo se acorta a 6 caracteres para que el SKU siga siendo legible
// y corto: "Acero Inoxidable" -> "ACEROI", "20000mAh" -> "20000M".
const MAX_ATTRIBUTE_TOKEN = 6;

function buildBaseSkuSuffix(attributes: Record<string, string>): string {
  return Object.values(attributes)
    .map((value) => sanitizeAttributeValue(value).slice(0, MAX_ATTRIBUTE_TOKEN))
    .filter((token) => token.length > 0)
    .join("-");
}

// Genera un SKU de variante único a partir del SKU del producto padre y sus
// atributos (ej: "COC-0012" + {color: "Negro", capacidad: "5L"} -> "COC-0012-NEGRO-5L").
// Si el candidato natural ya existe, prueba agregando -2, -3, ... hasta
// encontrar uno libre: nunca falla por colisión, siempre devuelve algo usable.
// El SKU de variante siempre es automático (no se acepta uno manual) para que
// todos los códigos sigan el mismo formato. `excludeVariantId` permite
// regenerarlo para una variante existente sin chocar consigo misma.
export async function generateUniqueVariantSku(
  productSku: string,
  attributes: Record<string, string>,
  excludeVariantId?: string
): Promise<string> {
  const suffix = buildBaseSkuSuffix(attributes);
  const base = suffix ? `${productSku}-${suffix}` : productSku;

  let candidate = base;
  let attempt = 1;
  for (;;) {
    const taken = await prisma.productVariant.findUnique({ where: { sku: candidate }, select: { id: true } });
    if (!taken || taken.id === excludeVariantId) break;
    attempt += 1;
    candidate = `${base}-${attempt}`;
  }
  return candidate;
}

// ---------------------------------------------------------------------------
// SKU de producto: <código de categoría>-<correlativo de 4 dígitos>, ej. COC-0001.
// ---------------------------------------------------------------------------

export const CATEGORY_CODE_PATTERN = /^[A-Z]{2,4}$/;

/** Código de 3 letras sugerido a partir del nombre ("Energía" -> "ENE"), único entre `taken`. */
export function suggestCategoryCode(name: string, taken: Set<string>): string {
  const letters = sanitizeAttributeValue(name).replace(/[^A-Z]/g, "") || "CAT";
  const words = name.normalize("NFD").replace(COMBINING_MARKS_PATTERN, "").toUpperCase().split(/[^A-Z]+/).filter(Boolean);
  const candidates = [
    letters.slice(0, 3).padEnd(3, "X"),
    // Iniciales de las palabras ("Hogar y Oficina" -> "HYO"), luego otras letras del nombre.
    words.map((w) => w[0]).join("").slice(0, 3).padEnd(3, "X"),
    ...[...letters.slice(3)].map((c) => letters.slice(0, 2) + c),
  ];
  for (const candidate of candidates) if (!taken.has(candidate)) return candidate;
  for (const a of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
    const candidate = letters.slice(0, 2).padEnd(2, "X") + a;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("No hay códigos de categoría disponibles");
}

/**
 * Reserva el siguiente SKU de producto de la categoría. Debe llamarse dentro de
 * la transacción que crea el producto: el UPDATE ... RETURNING del contador
 * bloquea la fila de la categoría hasta el commit, así dos productos creados a
 * la vez nunca reciben el mismo número.
 */
export async function generateProductSku(tx: Prisma.TransactionClient, categoryId: string): Promise<string> {
  for (;;) {
    const category = await tx.category.update({ where: { id: categoryId }, data: { skuCounter: { increment: 1 } }, select: { code: true, skuCounter: true } });
    const sku = `${category.code}-${String(category.skuCounter).padStart(4, "0")}`;
    // Si el prefijo se cambió y el número ya existe con otro producto, se salta.
    if (!(await tx.product.findUnique({ where: { sku }, select: { id: true } }))) return sku;
  }
}
