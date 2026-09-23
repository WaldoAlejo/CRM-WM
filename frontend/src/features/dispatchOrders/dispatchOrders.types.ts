export type BuyerType = "MAYORISTA" | "CLIENTE_FINAL";
export type DispatchStatus = "PENDIENTE" | "DESPACHADO" | "CANCELADO";
export type PaymentMethod = "CONTADO" | "CREDITO" | "CONTRA_ENTREGA";
export type PaymentStatus = "PENDIENTE" | "PAGADO" | "PARCIAL";
export type PriceType = "MAYORISTA" | "PVP";
// Semáforo de una cuenta a crédito: lo deriva el BACKEND al consultar (nunca se guarda).
export type CollectionStatus = "COMPLETADO" | "PENDIENTE" | "POR_VENCER" | "VENCIDO";
export type ShipmentStatus = "EN_TRANSITO" | "ENTREGADO" | "RECHAZADO" | "PERDIDO" | "DANADO";
export type ClaimStatus = "PENDIENTE" | "EN_REVISION" | "APROBADO" | "RECHAZADO" | "PAGADO";

export interface WholesalerRef {
  id: string;
  businessName: string;
}

export interface FinalCustomerRef {
  id: string;
  fullName: string;
}

export interface CourierRef {
  id: string;
  name: string;
}

// Fila del listado (GET /api/dispatch-orders): plano, sin items anidados.
export interface DispatchOrderListItem {
  id: string;
  orderNumber: string;
  buyerType: BuyerType;
  wholesaler: WholesalerRef | null;
  finalCustomer: FinalCustomerRef | null;
  status: DispatchStatus;
  dispatchDate: string | null;
  shippingProvince: string;
  shippingCity: string;
  paymentMethod: PaymentMethod;
  creditDays: number | null;
  dueDate: string | null;
  paymentStatus: PaymentStatus;
  amountPaid: string | null;
  itemsCount: number;
  createdAt: string;
}

export interface DispatchOrderItemVariantRef {
  sku: string;
  label: string | null;
}

// unitCostSnapshot/landedCostSnapshot son opcionales (no `| null`) porque
// para OPERATOR el backend los omite del JSON por completo — mismo criterio
// que Variant en products.types.ts.
export interface DispatchOrderItem {
  id: string;
  variantId: string;
  variant: DispatchOrderItemVariantRef;
  quantity: number;
  priceType: PriceType;
  unitPrice: string;
  markupPct?: string | null;
  discountPct: string | null;
  unitCostSnapshot?: string | null;
  landedCostSnapshot?: string | null;
}

export interface Payment {
  id: string;
  amount: string;
  method: string;
  paidAt: string;
  notes: string | null;
  createdAt: string;
  // Solo lo recibe ADMIN/CEO (OPERATOR no ve ni la marca): hay foto de comprobante.
  hasProof?: boolean;
}

export interface InsuranceClaimRef {
  id: string;
  claimAmount: string;
  status: ClaimStatus;
  claimDate: string;
  expectedResolutionDate: string;
}

export interface Shipment {
  id: string;
  courier: CourierRef;
  trackingNumber: string | null;
  isCOD: boolean;
  codAmountExpected: string | null;
  codAmountCollected: string | null;
  status: ShipmentStatus;
  deliveredAt: string | null;
  rejectionReason: string | null;
  claim: InsuranceClaimRef | null;
}

// Detalle completo (GET /api/dispatch-orders/:id). orderTotal viene
// calculado por el backend (computeOrderTotal, la misma función que recalcula
// paymentStatus al registrar un pago) — nunca se reimplementa la suma acá.
export interface DispatchOrderDetail {
  id: string;
  origin?: "NORMAL" | "CONSIGNACION_LIQUIDACION" | "CONSIGNACION_DEVOLUCION_NO_CONFORME";
  orderNumber: string;
  buyerType: BuyerType;
  wholesaler: WholesalerRef | null;
  finalCustomer: FinalCustomerRef | null;
  status: DispatchStatus;
  dispatchDate: string | null;
  notes: string | null;
  shippingProvince: string;
  shippingCity: string;
  paymentMethod: PaymentMethod;
  creditDays: number | null;
  dueDate: string | null;
  paymentStatus: PaymentStatus;
  amountPaid: string | null;
  orderTotal: string;
  // Semáforo (solo crédito despachado; null en cualquier otro caso).
  collectionStatus: CollectionStatus | null;
  items: DispatchOrderItem[];
  payments: Payment[];
  shipment: Shipment | null;
  createdAt: string;
}

// Fila de GET /api/accounts-receivable: mismos campos generales que el
// listado, sin itemsCount (no viene de la misma query) y con orderTotal
// (agregado junto con el detalle, misma función compartida).
export interface AccountsReceivableItem {
  id: string;
  orderNumber: string;
  wholesaler: WholesalerRef | null;
  finalCustomer: FinalCustomerRef | null;
  dueDate: string | null;
  paymentStatus: PaymentStatus;
  amountPaid: string | null;
  orderTotal: string;
  collectionStatus: CollectionStatus | null;
}
