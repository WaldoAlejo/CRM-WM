// Los 3 campos de costo del lote (flete/aranceles/otros) y, en cada movimiento,
// unitCost/landedCostPerUnit, son OPCIONALES en estos tipos a propósito: para
// OPERATOR el backend directamente no los manda (ver importBatches.serializer.ts
// e inventory.movementSerializer.ts), así que el tipo refleja "puede no venir",
// no "viene null".
export interface ImportBatchSupplierRef {
  id: string;
  name: string;
}

export interface ImportBatchListItem {
  id: string;
  containerType?: "20" | "40" | "40HC" | "LCL" | null;
  containerCbm?: string | null;
  reference: string;
  supplier: ImportBatchSupplierRef | null;
  arrivalDate: string;
  notes: string | null;
  createdAt: string;
  movementsCount: number;
  freightCost?: string | null;
  customsCost?: string | null;
  otherCosts?: string | null;
}

export interface ImportBatchMovement {
  packaging?: import('@/lib/cartonPackaging').CartonPackaging | null;
  id: string;
  variantId: string;
  quantity: number;
  volumeCbm?: string | null;
  notes: string | null;
  createdAt: string;
  toLocationId: string | null;
  unitCost?: string | null;
  landedCostPerUnit?: string | null;
  // productId no es costo/precio: viaja para cualquier rol (ver
  // backend/src/modules/importBatches/importBatches.service.ts). Lo usa la
  // calculadora de precios para enlazar "Usar este PVP" con /products/:id.
  variant: { sku: string; label: string | null; productId: string; dimensionsCm?: string | null; maxStackUnits?: number };
}

export interface ImportBatchDetail extends Omit<ImportBatchListItem, "movementsCount"> {
  movements: ImportBatchMovement[];
}

export interface ReceiveResponse {
  importBatchId: string;
  movements: ImportBatchMovement[];
}
