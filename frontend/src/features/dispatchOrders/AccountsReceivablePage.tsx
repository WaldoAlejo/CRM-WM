import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import { PaymentStatusBadge } from "./components/PaymentStatusBadge";
import type { AccountsReceivableItem } from "./dispatchOrders.types";
import { useAccountsReceivable } from "./useAccountsReceivable";

function daysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const diffMs = Date.now() - new Date(dueDate).getTime();
  return Math.max(0, Math.floor(diffMs / (24 * 60 * 60 * 1000)));
}

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
  {
    header: "Vencimiento",
    cell: (item) => (item.dueDate ? new Date(item.dueDate).toLocaleDateString("es-EC") : "—"),
  },
  {
    header: "Días vencida",
    cell: (item) => (
      <span className="font-medium text-destructive">{daysOverdue(item.dueDate)}</span>
    ),
  },
  { header: "Pago", cell: (item) => <PaymentStatusBadge status={item.paymentStatus} /> },
  {
    header: "Saldo",
    cell: (item) => `$${item.amountPaid ?? "0.00"} / $${item.orderTotal}`,
  },
];

// ADMIN-only: gateado en el router (RequireRole) que envuelve esta ruta,
// espejo del requireRole(Role.ADMIN) real que ahora tiene
// GET /api/accounts-receivable.
export function AccountsReceivablePage() {
  const { page, setPage, query } = useAccountsReceivable();
  const items = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Cuentas por cobrar</h1>
      <p className="text-sm text-muted-foreground">
        Órdenes a crédito vencidas y sin pagar por completo.
      </p>

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
