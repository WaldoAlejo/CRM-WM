import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import { ConsignmentStatusBadge } from "./components/ConsignmentStatusBadge";
import type { ConsignmentLotListItem } from "./consignment.types";
import { useConsignmentLots } from "./useConsignment";

const columns: CrudColumn<ConsignmentLotListItem>[] = [
  {
    header: "Lote",
    cell: (lot) => (
      <Link to={`/consignment/${lot.id}`} className="font-medium hover:underline">
        {lot.code}
      </Link>
    ),
  },
  { header: "Mayorista", cell: (lot) => lot.wholesaler.businessName },
  { header: "Estado", cell: (lot) => <ConsignmentStatusBadge status={lot.displayStatus} /> },
  {
    header: "Próxima revisión",
    cell: (lot) =>
      lot.status === "CERRADO" ? "—" : (
        <span className={lot.isReviewOverdue ? "font-medium text-destructive" : undefined}>
          {new Date(lot.nextReviewDate).toLocaleDateString("es-EC")}
        </span>
      ),
  },
  {
    header: "Pendiente / entregado",
    cell: (lot) => `${lot.totals.pending} / ${lot.totals.delivered}`,
  },
];

// ADMIN o CEO: gateado en el router (RequireRole) y en el backend
// (requireRole(ADMIN)). OPERATOR nunca ve lotes: traen precios.
export function ConsignmentPage() {
  const [searchParams] = useSearchParams();
  const overdueOnly = searchParams.get("overdue") === "true";
  const { page, setPage, query } = useConsignmentLots(overdueOnly);
  const lots = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Consignación</h1>
          <p className="text-sm text-muted-foreground">
            {overdueOnly
              ? "Lotes con la revisión vencida: contacta al mayorista y registra qué pasó."
              : "Seguimiento de productos entregados en consignación: revisiones, liquidaciones y devoluciones."}
          </p>
        </div>
        <Button asChild>
          <Link to="/dispatch-orders/new?modality=consignment">
            <PlusIcon /> Nuevo despacho en consignación
          </Link>
        </Button>
      </div>

      {overdueOnly ? (
        <Link to="/consignment" className="text-sm text-muted-foreground hover:underline">
          Ver todos los lotes
        </Link>
      ) : null}

      <DataTable
        columns={columns}
        data={lots}
        isLoading={query.isLoading}
        getRowId={(lot) => lot.id}
        rowClassName={(lot) => (lot.isReviewOverdue ? "bg-red-50" : undefined)}
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
