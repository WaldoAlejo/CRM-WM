import { useState } from "react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { SearchResult } from "@/features/search/search.types";
import { useSearch } from "@/features/search/useSearch";

interface VariantSearchAddProps {
  existingVariantIds: Set<string>;
  onAdd: (result: SearchResult) => void;
}

// Reusa useSearch (el mismo hook de la búsqueda global) sin duplicar la
// llamada a /api/search — el availableStock que ya viene en cada resultado
// es la foto de stock que después usa OrderItemsTable para el aviso visual,
// sin ningún request extra por línea.
export function VariantSearchAdd({ existingVariantIds, onAdd }: VariantSearchAddProps) {
  const [query, setQuery] = useState("");
  const debounced = useDebouncedValue(query, 300);
  const { data, isLoading } = useSearch(debounced);

  return (
    <Combobox<SearchResult>
      inputValue={query}
      onInputValueChange={setQuery}
      items={data?.data ?? []}
      isLoading={isLoading}
      getItemKey={(r) => r.variantId}
      placeholder="Buscar por SKU, nombre o código de barras..."
      emptyMessage={query.trim().length === 0 ? "Escribí para buscar" : "Sin resultados"}
      renderItem={(r) => (
        <div className="flex w-full items-center justify-between gap-3">
          <div>
            <p className="font-medium">
              {r.sku}
              {r.label ? ` — ${r.label}` : ""}
            </p>
            <p className="text-xs text-muted-foreground">{r.product.name}</p>
          </div>
          <span className={r.availableStock > 0 ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            {r.availableStock} disp.
          </span>
        </div>
      )}
      onSelect={(result) => {
        // Rechazo en el momento de agregar, no solo en el submit (el
        // superRefine de dispatchOrderFormSchema es el respaldo, no el
        // primer aviso): más útil decirlo ACÁ, cuando el usuario todavía
        // tiene el buscador abierto, que esperar a que intente guardar.
        if (existingVariantIds.has(result.variantId)) {
          toast.error(`${result.sku} ya está en la orden — combiná las cantidades en esa línea.`);
          return;
        }
        onAdd(result);
        setQuery("");
      }}
    />
  );
}
