// Espejo de backend/src/lib/sku.ts para mostrar el SKU que se va a generar.
// El backend sigue siendo quien lo asigna (y resuelve colisiones con -2, -3…).
const MAX_ATTRIBUTE_TOKEN = 6;

function sanitize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

/** "COC-0001" + ["Acero Inoxidable", "5 L"] -> "COC-0001-ACEROI-5L" */
export function previewVariantSku(productSku: string, values: string[]): string {
  const suffix = values.map((v) => sanitize(v).slice(0, MAX_ATTRIBUTE_TOKEN)).filter(Boolean).join("-");
  return suffix ? `${productSku}-${suffix}` : productSku;
}
