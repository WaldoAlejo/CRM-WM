export interface SearchResult {
  variantId: string;
  sku: string;
  barcode: string | null;
  label: string | null;
  stock: number;
  availableStock: number;
  warehouseLocation: string | null;
  product: {
    id: string;
    sku: string;
    name: string;
    model: string | null;
    status: "ACTIVE" | "DISCONTINUED";
  };
}
