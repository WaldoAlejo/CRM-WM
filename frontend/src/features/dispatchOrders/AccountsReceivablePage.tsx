import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { COLLECTION_STYLES, describeDeadline } from "./collectionStatus";
import { CollectionStatusBadge } from "./components/CollectionStatusBadge";
import { PaymentStatusBadge } from "./components/PaymentStatusBadge";
import type { AccountsReceivableItem, CollectionStatus } from "./dispatchOrders.types";
import { useAccountsReceivable } from "./useAccountsReceivable";
import type { ReceivableFilter } from "./useAccountsReceivable";

const columns: CrudColumn<AccountsReceivableItem>[] = [
  {
    header: "Orden",
    cell: (item) => (
      <Link to={`/dispatch-orders/${item.id}`} className="font-medium hover:underline">
        {item.orderNumber}
      </Link>
    ),
  },
  {
    header: "Comprador",
    cell: (item) => item.wholesaler?.businessName ?? item.finalCustomer?.fullName ?? "—",
  },
  // El semáforo: badge de color + (en DataTable) la fila entera tintada con barra lateral.
  { header: "Estado", cell: (item) => <CollectionStatusBadge status={item.collectionStatus} /> },
  {
    header: "Vencimiento",
    cell: (item) => (item.dueDate ? new Date(item.dueDate).toLocaleDateString("es-EC") : "—"),
  },
  {
    header: "Plazo",
    cell: (item) => (
      <span className={cn(item.collectionStatus === "VENCIDO" && "font-medium text-destructive")}>
        {describeDeadline(item.collectionStatus, item.dueDate)}
      </span>
    ),
  },
  { header: "Pago", cell: (item) => <PaymentStatusBadge status={item.paymentStatus} /> },
  {
    header: "Saldo",
    cell: (item) => `$${item.amountPaid ?? "0.00"} / $${item.orderTotal}`,
  },
];

// Vencidas es el valor por defecto: el listado de siempre.
const FILTERS: { value: ReceivableFilter; label: string }[] = [
  { value: "VENCIDO", label: "Vencidas" },
  { value: "POR_VENCER", label: "Por vencer" },
  { value: "PENDIENTE", label: "Pendientes" },
  { value: "COMPLETADO", label: "Completadas" },
  { value: "TODAS", label: "Todas" },
];

const DESCRIPTIONS: Record<ReceivableFilter, string> = {
  VENCIDO: "Órdenes a crédito vencidas y sin pagar por completo.",
  POR_VENCER: "Órdenes a crédito con saldo que vencen dentro de los próximos 7 días.",
  PENDIENTE: "Órdenes a crédito con saldo y más de 7 días para su vencimiento.",
  COMPLETADO: "Órdenes a crédito pagadas por completo.",
  TODAS: "Todas las órdenes a crédito, con su semáforo.",
};

function parseFilter(raw: string | null): ReceivableFilter {
  return FILTERS.some((f) => f.value === raw) ? (raw as ReceivableFilter) : "VENCIDO";
}

// ADMIN-only: gateado en el router (RequireRole) que envuelve esta ruta,
// espejo del requireRole(Role.ADMIN) real que ahora tiene
// GET /api/accounts-receivable.
export function AccountsReceivablePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = parseFilter(searchParams.get("status"));
  const { page, setPage, query } = useAccountsReceivable(filter);
  const items = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Cuentas por cobrar</h1>
      <p className="text-sm text-muted-foreground">{DESCRIPTIONS[filter]}</p>

      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por estado">
        {FILTERS.map((f) => (
          <Button
            key={f.value}
            size="sm"
            variant={filter === f.value ? "default" : "outline"}
            aria-pressed={filter === f.value}
            onClick={() => setSearchParams(f.value === "VENCIDO" ? {} : { status: f.value })}
          >
            {f.label}
          </Button>
        ))}
      </div>

      {/* Leyenda del semáforo: el mismo código de color que la fila y el badge. */}
      <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Leyenda">
        {(["COMPLETADO", "PENDIENTE", "POR_VENCER", "VENCIDO"] as CollectionStatus[]).map((s) => (
          <li key={s} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-full", COLLECTION_STYLES[s].dot)} aria-hidden />
            {COLLECTION_STYLES[s].label}
            {s === "POR_VENCER" ? " (≤ 7 días)" : ""}
          </li>
        ))}
      </ul>

      <DataTable
        columns={columns}
        data={items}
        isLoading={query.isLoading}
        getRowId={(item) => item.id}
        rowClassName={(item) => (item.collectionStatus ? COLLECTION_STYLES[item.collectionStatus].row : undefined)}
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
