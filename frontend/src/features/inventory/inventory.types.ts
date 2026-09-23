export interface StockByLocationRow {
  locationId: string;
  locationCode: string | null;
  warehouseId: string | null;
  warehouseName: string | null;
  variantId: string;
  sku: string | null;
  label: string | null;
  product: { id: string; sku: string; name: string } | null;
  netStock: number;
  volumeCbm?: number | null;
  estimatedFloorAreaM2?: number | null;
  stackLayers?: number | null;
}

// Espejo de toStockSummaryRow en inventory.service.ts.
export interface StockSummaryRow {
  variantId: string;
  sku: string;
  label: string | null;
  product: { id: string; sku: string; name: string };
  stock: number;
  reservedStock: number;
  availableStock: number;
  minStock: number | null;
  warehouseLocation: string | null;
  belowMinStock: boolean;
}
