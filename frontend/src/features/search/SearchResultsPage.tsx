import { useSearchParams } from "react-router-dom";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useSearch } from "./useSearch";

// Búsqueda pensada para "buscar → ver qué hay → despachar" (el despacho en
// sí es el próximo módulo): por ahora cada resultado linkea al detalle del
// producto dueño de esa variante.
export function SearchResultsPage() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";
  const { data, isLoading } = useSearch(q);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Resultados para &quot;{q}&quot;</h1>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : !data || data.data.length === 0 ? (
        <p className="text-muted-foreground">No se encontraron variantes para esa búsqueda.</p>
      ) : (
        <div className="space-y-2">
          {data.data.map((result) => (
            <Link key={result.variantId} to={`/products/${result.product.id}`}>
              <Card className="transition-colors hover:bg-accent">
                <CardContent className="flex items-center justify-between p-4">
                  <div>
                    <p className="font-medium">
                      {result.product.name} {result.label ? `— ${result.label}` : ""}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      SKU {result.sku}
                      {result.warehouseLocation ? ` · ${result.warehouseLocation}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {result.product.status === "DISCONTINUED" ? (
                      <Badge variant="secondary">Descontinuado</Badge>
                    ) : null}
                    <Badge variant={result.availableStock > 0 ? "default" : "destructive"}>
                      {result.availableStock} disponibles
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
