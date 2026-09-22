import { ArrowLeftIcon, PencilIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ProductFormDialog } from "./ProductFormDialog";
import { ProductImagesSection } from "./components/ProductImagesSection";
import { ProductReadonlySection } from "./components/ProductReadonlySection";
import type { PendingVariantEdit } from "./components/VariantsTable";
import { VariantsTable } from "./components/VariantsTable";
import { useProduct } from "./useProduct";

// "Usar este PVP" en la calculadora inline de un Lote de Importación llega
// hasta acá por estos 2 query params (no hay otra forma de cruzar de una
// página a otra sin repetir todo el formulario de variante ahí mismo).
function parsePendingEdit(params: URLSearchParams): PendingVariantEdit | null {
  const variantId = params.get("editVariantId");
  if (!variantId) return null;
  const raw = params.get("suggestedRetailPrice");
  const parsed = raw ? Number(raw) : undefined;
  return { variantId, retailPriceOverride: parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined };
}

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: product, isLoading } = useProduct(id);
  const [editOpen, setEditOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const pendingEdit = parsePendingEdit(searchParams);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!product) {
    return <p className="text-muted-foreground">Producto no encontrado.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/products" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
          <ArrowLeftIcon className="size-4" /> Productos
        </Link>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{product.name}</h1>
            <Badge variant={product.status === "ACTIVE" ? "default" : "secondary"}>
              {product.status === "ACTIVE" ? "Activo" : "Descontinuado"}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            SKU {product.sku} · {product.category.name}
            {product.subcategory ? ` / ${product.subcategory.name}` : ""}
            {product.brand ? ` · Marca: ${product.brand.name}` : ""}
          </p>
          {product.model ? <p className="text-sm text-muted-foreground">Modelo: {product.model}</p> : null}
          {product.barcode ? (
            <p className="text-sm text-muted-foreground">Código de barras: {product.barcode}</p>
          ) : null}
        </div>
        <Button variant="outline" onClick={() => setEditOpen(true)}>
          <PencilIcon /> Editar
        </Button>
      </div>

      {product.description ? <p className="max-w-2xl text-sm">{product.description}</p> : null}

      <ProductImagesSection productId={product.id} images={product.images} />

      <ProductReadonlySection certifications={product.certifications} attachments={product.attachments} />

      <VariantsTable
        productId={product.id}
        productStatus={product.status}
        variants={product.variants}
        pendingEdit={pendingEdit}
        onPendingEditHandled={() => setSearchParams({}, { replace: true })}
      />

      <ProductFormDialog open={editOpen} onOpenChange={setEditOpen} product={product} />
    </div>
  );
}
