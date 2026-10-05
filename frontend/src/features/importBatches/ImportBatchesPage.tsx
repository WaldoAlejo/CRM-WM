import { hasAdminAccess } from "@/lib/roles";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
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
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebouncedValue(search.trim());
  const { page, setPage, query } = useImportBatches(supplierId, debouncedSearch || undefined);
  useEffect(() => setPage(1), [debouncedSearch]);
  const { data: suppliers } = useSupplierOptions();

  const items = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  const columns: CrudColumn<ImportBatchListItem>[] = [
    {
      header: "Referencia",
      cell: (item) => (
        <Link to={`/import-batches/${item.id}`} className="whitespace-nowrap font-medium hover:underline">
          {item.reference}
        </Link>
      ),
    },
    { header: "Contenedor / BL", cell: (item) => <span className="whitespace-nowrap">{item.containerNumber ?? "—"}</span> },
    { header: "Modalidad", cell: (item) => item.containerType === "LCL" ? "Carga suelta / LCL" : item.containerType === "40HC" ? "40 HC" : item.containerType ? `${item.containerType} pies` : "—" },
    { header: "CBM contratados", cell: (item) => item.containerCbm ?? "—" },
    { header: "Llegada", cell: (item) => new Date(item.arrivalDate).toLocaleDateString("es-EC", { timeZone: "UTC" }) },
    { header: "Proveedor", cell: (item) => item.supplier?.name ?? "—" },
    { header: "Estado", cell: (item) => <BatchStatusBadge movementsCount={item.movementsCount} /> },
    // Costo a prorratear (flete+aranceles+otros): la columna ni existe para
    // OPERATOR — el backend no manda esos campos, y no se dibuja un "$0".
    ...(hasAdminAccess(role)
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
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Importaciones</h1>
        <Button asChild>
          <Link to="/import-batches/new">Nuevo lote</Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
      <Input
        type="search"
        aria-label="Buscar importaciones"
        placeholder="Buscar IMP- o contenedor"
        className="min-w-0 sm:w-64"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />
      <div className="w-full sm:w-64">
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
      </div>

      <DataTable columns={columns} data={items} isLoading={query.isLoading} getRowId={(item) => item.id} />

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
