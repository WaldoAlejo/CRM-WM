export type ProductStatus = "ACTIVE" | "DISCONTINUED";

export interface CategoryRef {
  id: string;
  name: string;
}

export interface SubcategoryRef {
  id: string;
  name: string;
}

export interface BrandRef {
  id: string;
  name: string;
}

// Fila del listado (GET /api/products): plano, sin variantes anidadas.
export interface ProductListItem {
  id: string;
  sku: string;
  name: string;
  model: string | null;
  status: ProductStatus;
  category: CategoryRef;
  subcategory: SubcategoryRef | null;
  brand: BrandRef | null;
  variantCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductImage {
  id: string;
  productId: string;
  url: string;
  position: number;
  createdAt: string;
}

export interface VariantImage {
  id: string;
  variantId: string;
  url: string;
  position: number;
  createdAt: string;
}

export interface Certification {
  id: string;
  productId: string;
  type: string;
  certNumber: string | null;
  issuedDate: string | null;
  fileUrl: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ProductAttachment {
  id: string;
  productId: string;
  type: string;
  url: string;
  createdAt: string;
}

// Variante tal como viene del detalle de producto. Los campos de precio son
// OPCIONALES en el tipo (no `| null`) porque para OPERATOR el backend los
// omite del JSON por completo — no vienen como `null`, no existen como key.
export interface Variant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  attributes: Record<string, string>;
  label: string | null;
  weightKg: string | null;
  dimensionsCm: string | null;
  stock: number;
  minStock: number | null;
  warehouseLocation: string | null;
  reservedStock: number;
  costPriceCNY?: string | null;
  wholesalePrice?: string | null;
  wholesaleDiscountPct?: string | null;
  retailPrice?: string | null;
  retailDiscountPct?: string | null;
  isActive: boolean;
  images: VariantImage[];
  createdAt: string;
  updatedAt: string;
}

// Detalle completo (GET /api/products/:id).
export interface ProductDetail {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  model: string | null;
  barcode: string | null;
  status: ProductStatus;
  categoryId: string;
  category: CategoryRef;
  subcategoryId: string | null;
  subcategory: SubcategoryRef | null;
  brandId: string | null;
  brand: BrandRef | null;
  images: ProductImage[];
  certifications: Certification[];
  attachments: ProductAttachment[];
  variants: Variant[];
  createdAt: string;
  updatedAt: string;
}
