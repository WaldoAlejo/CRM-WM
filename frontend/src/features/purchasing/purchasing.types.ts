// Una línea de la lista de reposición. NO tiene ningún campo de costo/precio:
// el backend ni los manda (ver purchasing.service.ts), y este tipo no los declara.
export interface ChinaRequestLine {
  variantId: string;
  productName: string;
  variantLabel: string | null;
  description: string | null;
  imageUrl: string | null;
  stock: number;
}

export interface ChinaRequestLowStock {
  threshold: number;
  total: number;
  data: ChinaRequestLine[];
}

export interface ChinaRequestSelection {
  variantId: string;
  quantity: number;
}
