export interface QuarantineQueueLine {
  id: string;
  batchId: string;
  source: "CONSIGNACION" | "COURIER_RECHAZADO";
  reference: string | null;
  wholesalerName: string | null;
  variant: { id: string; sku: string; label: string | null; productName: string; imageUrl: string | null };
  quantity: number;
  inspectedQuantity: number;
  remaining: number;
  originLocation: { id: string; code: string } | null;
  quarantineLocation: { id: string; code: string; warehouse: { id: string; name: string } } | null;
  receivedAt: string;
}

// Los 3 ítems fijos del checklist. El resultado (PASA/NO_PASA) lo decide el
// backend: acá solo se previsualiza para el operador.
export interface InspectionPayload {
  quantity: number;
  boxOk: boolean;
  noVisibleDamage: boolean;
  piecesComplete: boolean;
  observation?: string;
}

export interface InspectionResponse {
  inspection: { id: string; result: "PASA" | "NO_PASA" };
  line: { id: string; quantity: number; inspectedQuantity: number; remaining: number };
  batchCompleted: boolean;
  chargeGenerated: boolean;
}
