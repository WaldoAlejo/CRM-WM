// Utilidades para derivar el SKU y el label de una variante a partir de sus
// `attributes` (JSON flexible, ver comentario en ProductVariant del schema).
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

function buildBaseSkuSuffix(attributes: Record<string, string>): string {
  return Object.values(attributes)
    .map(sanitizeAttributeValue)
    .filter((token) => token.length > 0)
    .join("-");
}

// Genera un SKU de variante único a partir del SKU del producto padre y sus
// atributos (ej: "WM-0012" + {color: "Negro", capacidad: "5L"} -> "WM-0012-NEGRO-5L").
// Si el candidato natural ya existe, prueba agregando -2, -3, ... hasta
// encontrar uno libre: nunca falla por colisión, siempre devuelve algo usable.
// Solo se usa cuando el usuario NO especifica un sku manual (si lo especifica,
// se valida su unicidad tal cual la mandó, sin sufijos automáticos).
export async function generateUniqueVariantSku(
  productSku: string,
  attributes: Record<string, string>
): Promise<string> {
  const suffix = buildBaseSkuSuffix(attributes);
  const base = suffix ? `${productSku}-${suffix}` : productSku;

  let candidate = base;
  let attempt = 1;
  while (await prisma.productVariant.findUnique({ where: { sku: candidate } })) {
    attempt += 1;
    candidate = `${base}-${attempt}`;
  }
  return candidate;
}
