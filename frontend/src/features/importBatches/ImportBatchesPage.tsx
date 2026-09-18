import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/context/AuthContext";
import { BatchStatusBadge } from "./components/BatchStatusBadge";
import type { ImportBatchListItem } from "./importBatches.types";
import { totalBatchCost } from "./landedCost";
import { useImportBatches } from "./useImportBatches";
import { useSupplierOptions } from "./useSupplierOptions";

const ALL = "__all__";

export function ImportBatchesPage() {
  const { role } = useAuth();
  const [supplierId, setSupplierId] = useState<string | undefined>(undefined);
  const { page, setPage, query } = useImportBatches(supplierId);
  const { data: suppliers } = useSupplierOptions();

  const items = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  const columns: CrudColumn<ImportBatchListItem>[] = [
    {
      header: "Referencia",
      cell: (item) => (
        <Link to={`/import-batches/${item.id}`} className="font-medium hover:underline">
          {item.reference}
        </Link>
      ),
    },
    { header: "Llegada", cell: (item) => new Date(item.arrivalDate).toLocaleDateString("es-EC", { timeZone: "UTC" }) },
    { header: "Proveedor", cell: (item) => item.supplier?.name ?? "—" },
    { header: "Estado", cell: (item) => <BatchStatusBadge movementsCount={item.movementsCount} /> },
    // Costo a prorratear (flete+aranceles+otros): la columna ni existe para
    // OPERATOR — el backend no manda esos campos, y no se dibuja un "$0".
    ...(role === "ADMIN"
      ? [
          {
            header: "Costos del lote",
            cell: (item: ImportBatchListItem) =>
              `$${totalBatchCost({
                freightCost: Number(item.freightCost) || 0,
                customsCost: Number(item.customsCost) || 0,
                otherCosts: Number(item.otherCosts) || 0,
              }).toFixed(2)}`,
          },
        ]
      : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Importaciones</h1>
        <Button asChild>
          <Link to="/import-batches/new">Nuevo lote</Link>
        </Button>
      </div>

      <div className="w-64">
        <Select
          value={supplierId ?? ALL}
          onValueChange={(value) => {
            setSupplierId(value === ALL ? undefined : value);
            setPage(1);
          }}
        >
          <SelectTrigger aria-label="Filtrar por proveedor">
            <SelectValue placeholder="Proveedor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los proveedores</SelectItem>
            {(suppliers ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <DataTable columns={columns} data={items} isLoading={query.isLoading} getRowId={(item) => item.id} />

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
