import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ProductFormDialog } from "./ProductFormDialog";
import { useCategoryOptions } from "./useCategoryOptions";
import type { ProductFilters } from "./useProducts";
import { useProducts } from "./useProducts";
import type { ProductListItem } from "./products.types";
import { usePricingVisibility } from '@/hooks/usePricingVisibility';

const ALL = "__all__"; // Radix Select no permite value="" en SelectItem; se traduce a "sin filtro" acá.

const columns: CrudColumn<ProductListItem>[] = [
  { header: "SKU", cell: (item) => item.sku },
  {
    header: "Nombre",
    cell: (item) => (
      <Link to={`/products/${item.id}`} className="font-medium hover:underline">
        {item.name}
      </Link>
    ),
  },
  {
    header: "Categoría",
    cell: (item) => (item.subcategory ? `${item.category.name} / ${item.subcategory.name}` : item.category.name),
  },
  { header: "Marca", cell: (item) => item.brand?.name ?? "—" },
  {
    header: "Estado",
    cell: (item) => (
      <Badge variant={item.status === "ACTIVE" ? "default" : "secondary"}>
        {item.status === "ACTIVE" ? "Activo" : "Descontinuado"}
      </Badge>
    ),
  },
  { header: "Variantes", cell: (item) => item.variantCount },
];

export function ProductsPage() {
  const canSeePricing = usePricingVisibility();
  const visibleColumns: CrudColumn<ProductListItem>[] = [...columns, ...(canSeePricing ? [{
    header: 'Costo promedio ponderado (USD)', cell: (item: ProductListItem) => item.weightedAverageCost != null ? `$${item.weightedAverageCost}` : '—',
  }] : [])];
  const [filters, setFilters] = useState<ProductFilters>({});
  const [searchInput, setSearchInput] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const { page, setPage, query } = useProducts(filters);
  const { data: categories } = useCategoryOptions();

  const selectedCategory = categories?.find((c) => c.id === filters.categoryId);
  const items = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  function updateFilter<K extends keyof ProductFilters>(key: K, value: ProductFilters[K]) {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Productos</h1>
        <Button onClick={() => setCreateOpen(true)}>Nuevo producto</Button>
      </div>

      {createOpen ? (
        <ProductFormDialog open={createOpen} onOpenChange={setCreateOpen} product={null} />
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            updateFilter("q", searchInput || undefined);
          }}
        >
          <Input
            placeholder="Buscar por nombre, SKU o modelo..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-64"
          />
          <Button type="submit" variant="outline" size="icon">
            <SearchIcon />
          </Button>
        </form>

        <Select
          value={filters.categoryId ?? ALL}
          onValueChange={(value) => {
            updateFilter("categoryId", value === ALL ? undefined : value);
            updateFilter("subcategoryId", undefined);
          }}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las categorías</SelectItem>
            {categories?.map((category) => (
              <SelectItem key={category.id} value={category.id}>
                {category.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {selectedCategory && selectedCategory.subcategories.length > 0 ? (
          <Select
            value={filters.subcategoryId ?? ALL}
            onValueChange={(value) => updateFilter("subcategoryId", value === ALL ? undefined : value)}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Subcategoría" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Todas las subcategorías</SelectItem>
              {selectedCategory.subcategories.map((sub) => (
                <SelectItem key={sub.id} value={sub.id}>
                  {sub.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}

        <Select
          value={filters.status ?? ALL}
          onValueChange={(value) => updateFilter("status", value === ALL ? undefined : (value as "ACTIVE" | "DISCONTINUED"))}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            <SelectItem value="ACTIVE">Activo</SelectItem>
            <SelectItem value="DISCONTINUED">Descontinuado</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {canSeePricing && <p className="text-xs text-muted-foreground">Costo real por unidad: incluye gastos de importación y pondera las unidades recibidas de las variantes. Sin ingresos con costo se muestra —.</p>}
      <DataTable columns={visibleColumns} data={items} isLoading={query.isLoading} getRowId={(item) => item.id} />

      {pagination ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {pagination.page} de {pagination.totalPages} · {pagination.total} en total
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeftIcon /> Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= pagination.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Siguiente <ChevronRightIcon />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
