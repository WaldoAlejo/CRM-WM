import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useWarehouseOptions } from "../warehouses/useWarehouseOptions";
import type { StockByLocationRow } from "./inventory.types";
import { useStockByLocation } from "./useStockByLocation";

const columns: CrudColumn<StockByLocationRow>[] = [
  {
    header: "Producto",
    cell: (item) => (
      <div>
        <p className="font-medium">{item.sku}</p>
        {item.label ? <p className="text-xs text-muted-foreground">{item.label}</p> : null}
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
  const { page, setPage, query } = useStockByLocation(warehouseId);
  const { data: warehouses } = useWarehouseOptions();

  const items = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inventario · Stock por ubicación</h1>
        <Link to="/inventory/low-stock" className="text-sm text-primary hover:underline">
          Ver alertas de stock bajo →
        </Link>
      </div>

      <div className="w-64">
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
