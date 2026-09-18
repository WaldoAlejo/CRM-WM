import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCourierOptions } from "@/features/dispatchOrders/useCourierOptions";
import { ClaimStatusBadge } from "./components/ClaimStatusBadge";
import { OverdueBadge, isClaimOverdue } from "./components/OverdueBadge";
import { PendingByCourierSummary } from "./components/PendingByCourierSummary";
import { ResolveCustomerDialog } from "./components/ResolveCustomerDialog";
import { UpdateClaimStatusDialog } from "./components/UpdateClaimStatusDialog";
import type { InsuranceClaim } from "./insuranceClaims.types";
import type { InsuranceClaimFilters } from "./useInsuranceClaims";
import { useInsuranceClaims } from "./useInsuranceClaims";

const ALL = "__all__"; // Radix Select no permite value="" en SelectItem; se traduce a "sin filtro" acá.

const columns: CrudColumn<InsuranceClaim>[] = [
  {
    header: "Orden",
    cell: (claim) => (
      <Link to={`/dispatch-orders/${claim.shipment.dispatchOrder.id}`} className="font-medium hover:underline">
        {claim.shipment.dispatchOrder.orderNumber}
      </Link>
    ),
  },
  { header: "Courier", cell: (claim) => claim.shipment.courier.name },
  { header: "Monto", cell: (claim) => `$${claim.claimAmount}` },
  { header: "Estado", cell: (claim) => <ClaimStatusBadge status={claim.status} /> },
  {
    header: "Resolución cliente",
    cell: (claim) =>
      claim.customerResolution === "PENDIENTE"
        ? "Pendiente"
        : claim.customerResolution === "REEMPLAZO"
          ? "Reemplazo"
          : "Reembolso",
  },
  {
    header: "Vence",
    cell: (claim) => (
      <div className="flex items-center gap-2">
        <span>{new Date(claim.expectedResolutionDate).toLocaleDateString("es-EC")}</span>
        <OverdueBadge status={claim.status} expectedResolutionDate={claim.expectedResolutionDate} />
      </div>
    ),
  },
];

// ADMIN-only: gateado en el router (RequireRole), espejo de
// requireRole(Role.ADMIN) real en insuranceClaims.routes.ts.
export function InsuranceClaimsPage() {
  // Lectura de UNA sola vez al montar (no bidireccional como el rango de
  // fechas de Reportes): alcanza para que el link del Dashboard
  // ("/insurance-claims?open=true") llegue con el filtro ya aplicado, sin
  // necesidad de mantener sincronizada la URL con cada cambio de filtro acá.
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = useState<InsuranceClaimFilters>({
    open: searchParams.get("open") === "true" || undefined,
  });
  const { page, setPage, query } = useInsuranceClaims(filters);
  const { data: couriers } = useCourierOptions();
  const [resolveTarget, setResolveTarget] = useState<string | null>(null);
  const [statusTarget, setStatusTarget] = useState<string | null>(null);

  const items = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;
  const pendingByCourier = query.data?.pendingByCourier ?? [];

  function updateFilter<K extends keyof InsuranceClaimFilters>(key: K, value: InsuranceClaimFilters[K]) {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Reclamos de seguro</h1>

      <PendingByCourierSummary pendingByCourier={pendingByCourier} />

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.courierId ?? ALL}
          onValueChange={(value) => updateFilter("courierId", value === ALL ? undefined : value)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Courier" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los couriers</SelectItem>
            {couriers?.map((courier) => (
              <SelectItem key={courier.id} value={courier.id}>
                {courier.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status ?? ALL}
          onValueChange={(value) => updateFilter("status", value === ALL ? undefined : (value as never))}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            <SelectItem value="PENDIENTE">Pendiente</SelectItem>
            <SelectItem value="EN_REVISION">En revisión</SelectItem>
            <SelectItem value="APROBADO">Aprobado</SelectItem>
            <SelectItem value="RECHAZADO">Rechazado</SelectItem>
            <SelectItem value="PAGADO">Pagado</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.customerResolution ?? ALL}
          onValueChange={(value) => updateFilter("customerResolution", value === ALL ? undefined : (value as never))}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Resolución cliente" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas</SelectItem>
            <SelectItem value="PENDIENTE">Pendiente</SelectItem>
            <SelectItem value="REEMPLAZO">Reemplazo</SelectItem>
            <SelectItem value="REEMBOLSO">Reembolso</SelectItem>
          </SelectContent>
        </Select>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={filters.open ?? false}
            onChange={(e) => updateFilter("open", e.target.checked || undefined)}
          />
          Solo en proceso
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={filters.overdue ?? false}
            onChange={(e) => updateFilter("overdue", e.target.checked || undefined)}
          />
          Solo vencidos
        </label>
      </div>

      <DataTable
        columns={columns}
        data={items}
        isLoading={query.isLoading}
        getRowId={(claim) => claim.id}
        rowClassName={(claim) =>
          isClaimOverdue(claim.status, claim.expectedResolutionDate) ? "bg-destructive/5" : undefined
        }
        actions={(claim) => (
          <div className="flex justify-end gap-1">
            {claim.customerResolution === "PENDIENTE" ? (
              <Button variant="ghost" size="sm" onClick={() => setResolveTarget(claim.id)}>
                Resolver con cliente
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => setStatusTarget(claim.id)}>
              Actualizar estado
            </Button>
          </div>
        )}
      />

      {resolveTarget ? (
        <ResolveCustomerDialog
          open={resolveTarget !== null}
          onOpenChange={(open) => !open && setResolveTarget(null)}
          claimId={resolveTarget}
        />
      ) : null}
      {statusTarget ? (
        <UpdateClaimStatusDialog
          open={statusTarget !== null}
          onOpenChange={(open) => !open && setStatusTarget(null)}
          claimId={statusTarget}
        />
      ) : null}

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
