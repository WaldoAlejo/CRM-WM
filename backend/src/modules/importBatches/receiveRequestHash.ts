import { createHash } from "crypto";

interface ReceiveLine {
  variantId: string;
  quantity: number;
  unitCost: number;
  notes?: string;
}

// Hash determinístico del body de /receive: el mismo conjunto de líneas debe
// dar el mismo hash sin importar en qué orden vinieron. Primero se serializa
// cada línea con sus claves en un orden FIJO (no el que trajo el JSON), y
// después se ordena el arreglo de líneas ya serializadas — así ni el orden
// de las claves dentro de una línea ni el orden de las líneas entre sí
// afectan el resultado.
function canonicalizeLine(line: ReceiveLine): string {
  return JSON.stringify({
    variantId: line.variantId,
    quantity: line.quantity,
    unitCost: line.unitCost,
    notes: line.notes ?? null,
  });
}

export function computeReceiveRequestHash(lines: ReceiveLine[]): string {
  const canonicalLines = lines.map(canonicalizeLine).sort();
  return createHash("sha256").update(JSON.stringify(canonicalLines)).digest("hex");
}
