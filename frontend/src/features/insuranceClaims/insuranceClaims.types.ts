export type ClaimStatus = "PENDIENTE" | "EN_REVISION" | "APROBADO" | "RECHAZADO" | "PAGADO";
export type CustomerResolution = "PENDIENTE" | "REEMPLAZO" | "REEMBOLSO";

export interface InsuranceClaimCourierRef {
  id: string;
  name: string;
}

export interface InsuranceClaimOrderRef {
  id: string;
  orderNumber: string;
}

// Fila de GET /api/insurance-claims. No hay GET /insurance-claims/:id — este
// es el único shape que existe, y las acciones (resolver con cliente,
// actualizar estado) se disparan directo desde esta fila, sin un fetch de
// detalle aparte.
export interface InsuranceClaim {
  id: string;
  shipmentId: string;
  claimAmount: string;
  status: ClaimStatus;
  reimbursedAmount: string | null;
  claimDate: string;
  resolvedDate: string | null;
  notes: string | null;
  expectedResolutionDate: string;
  customerResolution: CustomerResolution;
  shipment: {
    courier: InsuranceClaimCourierRef;
    dispatchOrder: InsuranceClaimOrderRef;
  };
}

export interface PendingByCourier {
  courierId: string;
  courierName: string;
  totalPending: string;
}

// Resultado de POST /:id/resolve-customer con resolution=REPLACEMENT. La
// orden viene recién creada, TODAVÍA NO CONFIRMADA (sin shipment, sin
// codAmountExpected real) — items[].unitPrice ya refleja si sale a cobrar el
// monto completo o $0 (si la original ya estaba pagada), así que el "COD
// esperado" que se muestra en el dialog se arma sumando esto mismo, NO
// inventando un valor nuevo ni esperando a que se confirme.
export interface ReplacementOrderResult {
  id: string;
  orderNumber: string;
  paymentMethod: "CONTADO" | "CREDITO" | "CONTRA_ENTREGA";
  replacesOrderId: string;
  items: { unitPrice: string; quantity: number }[];
}

export interface ResolveCustomerReplacementResult {
  insuranceClaim: { id: string; customerResolution: CustomerResolution };
  replacementOrder: ReplacementOrderResult;
}

export interface ResolveCustomerRefundResult {
  insuranceClaim: { id: string; customerResolution: CustomerResolution };
  payment: { id: string; amount: string };
  dispatchOrder: { id: string; paymentStatus: string; amountPaid: string | null };
}

export type ResolveCustomerResult = ResolveCustomerReplacementResult | ResolveCustomerRefundResult;

export function isReplacementResult(
  result: ResolveCustomerResult
): result is ResolveCustomerReplacementResult {
  return "replacementOrder" in result;
}
