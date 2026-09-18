import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import type { StockSummaryRow } from "./inventory.types";
import { useLowStock } from "./useLowStock";

const columns: CrudColumn<StockSummaryRow>[] = [
  {
    header: "Producto",
    cell: (item) => (
      <div>
        <p className="font-medium">{item.sku}</p>
        {item.label ? <p className="text-xs text-muted-foreground">{item.label}</p> : null}
      </div>
    ),
  },
  { header: "Stock", cell: (item) => item.stock },
  { header: "Disponible", cell: (item) => item.availableStock },
  { header: "Mínimo", cell: (item) => item.minStock },
];

// Alcanzado desde la alerta "Stock bajo" del Dashboard — GET
// /inventory/stock-summary?belowMinStock=true, el filtro ya viene aplicado
// por el propio endpoint, no hay nada que configurar acá.
export function LowStockPage() {
  const { page, setPage, query } = useLowStock();
  const items = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Stock bajo</h1>
          <p className="text-sm text-muted-foreground">Variantes con stock por debajo de su punto de reorden.</p>
        </div>
        <Link to="/inventory" className="text-sm text-primary hover:underline">
          Ver stock por ubicación →
        </Link>
      </div>

      <DataTable columns={columns} data={items} isLoading={query.isLoading} getRowId={(item) => item.variantId} />

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
