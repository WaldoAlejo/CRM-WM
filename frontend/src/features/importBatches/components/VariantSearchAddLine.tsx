import { useState } from "react";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { SearchResult } from "@/features/search/search.types";
import { useSearch } from "@/features/search/useSearch";

interface VariantSearchAddLineProps {
  existingVariantIds: Set<string>;
  onAdd: (result: SearchResult) => void;
}

// Mismo buscador que Despachos (useSearch → /api/search), con el mensaje de
// duplicado propio del ingreso.
export function VariantSearchAddLine({ existingVariantIds, onAdd }: VariantSearchAddLineProps) {
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
          <span className="text-xs text-muted-foreground">{r.stock} en stock</span>
        </div>
      )}
      onSelect={(result) => {
        if (existingVariantIds.has(result.variantId)) {
          toast.error(`${result.sku} ya está en el ingreso — combiná las cantidades en esa línea.`);
          return;
        }
        onAdd(result);
        setQuery("");
      }}
    />
  );
}
