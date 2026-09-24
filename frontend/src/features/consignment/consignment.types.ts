export type ConsignmentStatus = "EN_CONSIGNACION" | "LIQUIDADO_PARCIAL" | "CERRADO";
// "Revisión vencida" NO se guarda en el backend: se deriva de nextReviewDate
// (ver computeDisplayStatus). El backend ya manda `displayStatus` resuelto.
export type ConsignmentDisplayStatus = ConsignmentStatus | "REVISION_VENCIDA";

export interface ConsignmentLotListItem {
  id: string;
  code: string;
  wholesaler: { id: string; businessName: string };
  deliveredAt: string;
  nextReviewDate: string;
  status: ConsignmentStatus;
  displayStatus: ConsignmentDisplayStatus;
  isReviewOverdue: boolean;
  creditDays: number;
  totals: { delivered: number; sold: number; returned: number; pending: number };
}

export interface ConsignmentLine {
  id: string;
  variantId: string;
  sku: string;
  label: string | null;
  productName: string;
  originLocationId: string | null;
  quantityDelivered: number;
  unitPrice: string;
  sold: number;
  returned: number;
  pending: number;
}

export interface ConsignmentReview {
  id: string;
  reviewedAt: string;
  action: "EXTENDER" | "LIQUIDAR";
  nextReviewDate: string | null;
  notes: string | null;
  lines: { lineId: string; quantitySold: number; quantityReturned: number }[];
  chargeOrder: { id: string; orderNumber: string; dueDate: string | null } | null;
  returnBatch: { id: string; completedAt: string | null; chargeOrder: { id: string; orderNumber: string } | null } | null;
}

export interface ConsignmentLotDetail {
  dispatchOrderId?: string | null;
  id: string;
  code: string;
  wholesaler: { id: string; businessName: string };
  shippingProvince: string;
  shippingCity: string;
  deliveredAt: string;
  reviewIntervalDays: number;
  creditDays: number;
  nextReviewDate: string;
  status: ConsignmentStatus;
  displayStatus: ConsignmentDisplayStatus;
  isReviewOverdue: boolean;
  notes: string | null;
  lines: ConsignmentLine[];
  reviews: ConsignmentReview[];
}

export interface CreateConsignmentLotPayload {
  wholesalerId: string;
  shippingProvince: string;
  shippingCity: string;
  creditDays?: number;
  notes?: string;
  lines: { variantId: string; quantity: number; unitPrice?: number; locationId?: string }[];
}

export type CreateReviewPayload =
  | { action: "EXTENDER"; notes?: string }
  | {
      action: "LIQUIDAR";
      notes?: string;
      lines: { lineId: string; quantitySold: number; quantityReturned: number }[];
    };
