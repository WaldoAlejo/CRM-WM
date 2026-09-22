// Todos los números vienen ya calculados por el backend — nunca se
// reconstruyen acá. Los campos de costo/ganancia son directamente OPCIONALES
// (no `string | null`): para OPERATOR el backend ni siquiera los manda, así
// que el tipo lo refleja tal cual (ver GET /dashboard/summary).
export interface SalesPeriod {
  unitsSold: number;
  totalRevenue: string;
  totalCost?: string;
  profit?: string;
  profitMarginPct?: string;
}

export interface StockAlertItem {
  variantId: string;
  sku: string;
  label: string | null;
  productName: string;
  stock: number;
  minStock: number | null;
}

export interface DashboardSummary {
  stockAlerts: { count: number; items: StockAlertItem[] };
  pendingCourierShipments: { count: number };
  sales: { today: SalesPeriod; week: SalesPeriod; month: SalesPeriod };
  // Ausentes del todo para OPERATOR — nunca `null`.
  accountsReceivable?: {
    overdueCount: number;
    totalOutstanding: string;
    // Semáforo de la cartera con saldo pendiente (mismo clasificador que el listado y el detalle).
    byStatus?: Record<"VENCIDO" | "POR_VENCER" | "PENDIENTE", { count: number; outstanding: string }>;
  };
  insuranceClaims?: { pendingCount: number };
  // Lotes de consignación con la revisión vencida (ausente para OPERATOR).
  consignment?: { overdueReviewCount: number };
}
