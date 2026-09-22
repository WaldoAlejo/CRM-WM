// Todos los números vienen ya calculados por el backend (unitCostSnapshot/
// landedCostSnapshot congelados) — el frontend nunca reconstruye
// profit/profitMarginPct a partir de otros campos, solo los muestra.
export interface ProfitabilityTotals {
  unitsSold: number;
  totalRevenue: string;
  totalCost: string;
  profit: string;
  profitMarginPct: string;
}

export interface ProfitabilityByCategory extends ProfitabilityTotals {
  categoryId: string;
  categoryName: string;
}

export interface TopProduct {
  variantId: string;
  sku: string;
  label: string | null;
  productName: string;
  unitsSold: number;
  totalRevenue: string;
  profit: string;
}

export interface ProfitabilitySummary {
  period: { dateFrom: string | null; dateTo: string | null };
  totals: ProfitabilityTotals;
  byCategory: ProfitabilityByCategory[];
  byBuyer?: (ProfitabilityTotals & { buyerId: string; buyerType: string; buyerName: string })[];
  topProductsByProfit: TopProduct[];
}

// Igual que en el service: la línea NO trae categoryName (solo categoryId) —
// espejo exacto de toLineOutput en reports.service.ts.
export interface ProfitabilityLine extends ProfitabilityTotals {
  variantId: string;
  sku: string;
  label: string | null;
  productId: string;
  productName: string;
  categoryId: string;
}

export interface ProfitabilityReport {
  filters: { dateFrom: string | null; dateTo: string | null; categoryId: string | null; variantId: string | null };
  lines: ProfitabilityLine[];
  totals: ProfitabilityTotals;
  ventasConReclamoPendiente: { lines: ProfitabilityLine[]; totals: ProfitabilityTotals };
}
