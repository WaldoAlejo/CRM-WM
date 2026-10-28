import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { getAssetUrl } from "@/lib/api";
import { useWarehouseOptions } from "../warehouses/useWarehouseOptions";
import type { StockByLocationRow } from "./inventory.types";
import { useStockByLocation } from "./useStockByLocation";

const columns: CrudColumn<StockByLocationRow>[] = [
  {
    header: "Producto",
    cell: (item) => (
      <div className="flex min-w-56 items-center gap-3">
        <div className="size-12 shrink-0 overflow-hidden rounded-md border bg-muted">
          {item.imageUrl ? (
            <img src={getAssetUrl(item.imageUrl)} alt={item.product?.name ?? item.sku ?? ""} loading="lazy" className="size-full object-cover" />
          ) : null}
        </div>
        <div>
          <p className="font-medium">{item.product?.name ?? item.sku}</p>
          <p className="text-xs text-muted-foreground">
            {item.sku}
            {item.label ? ` · ${item.label}` : ""}
          </p>
        </div>
      </div>
    ),
  },
  { header: "Bodega", cell: (item) => item.warehouseName ?? "—" },
  { header: "Ubicación", cell: (item) => item.locationCode ?? "—" },
  {
    header: "Stock",
    cell: (item) => <span className="font-medium">{item.netStock}</span>,
  },
  { header: 'Volumen estimado (m³)', cell: item => item.volumeCbm?.toFixed(6) ?? 'Sin datos suficientes' },
  { header: 'Empaque estimado', cell: item => item.cartonEstimate?.status === 'MIXED' ? 'Empaques mixtos: revisar ingresos' : item.cartonEstimate ? <span title="Equivalencia teórica si se consolidan las unidades; no es un conteo de cartones abiertos.">{item.cartonEstimate.cartons} cartones · equivalen a {item.cartonEstimate.fullCartonEquivalent} completos + {item.cartonEstimate.looseUnitEquivalent} unidades</span> : 'Sin registro de cartones' },
  { header: 'Apilamiento estimado', cell: item => item.cartonEstimate ? item.cartonEstimate.status === 'MIXED' ? '—' : `${item.cartonEstimate.piles ?? '—'} pilas · ${item.cartonEstimate.stackCartons ?? '—'} cartones/pila (${item.cartonEstimate.stackingConfirmed ? 'confirmado' : 'provisional'})` : item.stackLayers != null ? `${item.stackLayers} unidades/pila` : '—' },
  { header: 'Superficie estimada (m²)', cell: item => item.estimatedFloorAreaM2?.toFixed(3) ?? '—' },
];

// Stock actual por ubicación, agregado en vivo desde el ledger de
// InventoryMovement (GET /inventory/stock-by-location) — no un contador
// aparte, mismo patrón que /inventory/stock-summary. Vive en /inventory
// hasta que exista una página de Inventario/Dashboard más completa.
export function StockByLocationPage() {
  const [warehouseId, setWarehouseId] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const { page, setPage, query } = useStockByLocation(warehouseId, debouncedSearch || undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setPage(1), [debouncedSearch]);
  const { data: warehouses } = useWarehouseOptions();

  const items = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Inventario · Stock por ubicación</h1>
        <Link to="/inventory/low-stock" className="text-sm text-primary hover:underline">
          Ver alertas de stock bajo →
        </Link>
      </div>

      <Input
        type="search"
        aria-label="Buscar producto"
        placeholder="Buscar por nombre o SKU"
        className="min-w-0 sm:w-80"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="w-full sm:w-64">
        <p className="mb-3 text-xs text-muted-foreground">Los cartones son equivalencias estimadas del stock si se consolidan las unidades; no cuentan cajas abiertas. El volumen incluye el cartón parcial y usa el promedio informado de ingresos compatibles. Sin medidas no se calcula superficie.</p>
        <Select
          value={warehouseId ?? "all"}
          onValueChange={(value) => {
            setWarehouseId(value === "all" ? undefined : value);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filtrar por bodega">
            <SelectValue placeholder="Todas las bodegas" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las bodegas</SelectItem>
            {(warehouses ?? []).map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={items}
        isLoading={query.isLoading}
        getRowId={(item) => `${item.locationId}-${item.variantId}`}
      />

      {pagination ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
          <span>
            Página {pagination.page} de {pagination.totalPages} · {pagination.total} en total
          </span>
          <div className="flex flex-wrap gap-2">
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
