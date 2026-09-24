import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { DataTable } from "@/components/crud/DataTable";
import type { CrudColumn } from "@/components/crud/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ECUADOR_PROVINCES } from "@/lib/ecuadorProvinces";
import { DispatchStatusBadge } from "./components/DispatchStatusBadge";
import { PaymentStatusBadge } from "./components/PaymentStatusBadge";
import type { DispatchOrderListItem } from "./dispatchOrders.types";
import type { DispatchOrderFilters } from "./useDispatchOrders";
import { useDispatchOrders } from "./useDispatchOrders";

const ALL = "__all__"; // Radix Select no permite value="" en SelectItem; se traduce a "sin filtro" acá.

const columns: CrudColumn<DispatchOrderListItem>[] = [
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
  { header: "Estado", cell: (item) => <DispatchStatusBadge status={item.status} /> },
  { header: "Pago", cell: (item) => item.paymentMethod === "CONSIGNACION" ? "Sin cargo · Consignación" : <PaymentStatusBadge status={item.paymentStatus} /> },
  { header: "Envío", cell: (item) => `${item.shippingProvince}, ${item.shippingCity}` },
  { header: "Ítems", cell: (item) => item.itemsCount },
  {
    header: "Creada",
    cell: (item) => new Date(item.createdAt).toLocaleDateString("es-EC"),
  },
];

export function DispatchOrdersPage() {
  const [filters, setFilters] = useState<DispatchOrderFilters>({});
  const { page, setPage, query } = useDispatchOrders(filters);

  const items = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  function updateFilter<K extends keyof DispatchOrderFilters>(key: K, value: DispatchOrderFilters[K]) {
    setPage(1);
    setFilters((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Órdenes de despacho</h1>
        <Button asChild>
          <Link to="/dispatch-orders/new">Nueva orden</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={filters.status ?? ALL}
          onValueChange={(value) => updateFilter("status", value === ALL ? undefined : (value as never))}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los estados</SelectItem>
            <SelectItem value="PENDIENTE">Pendiente</SelectItem>
            <SelectItem value="DESPACHADO">Despachado</SelectItem>
            <SelectItem value="CANCELADO">Cancelado</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.paymentMethod ?? ALL}
          onValueChange={(value) => updateFilter("paymentMethod", value === ALL ? undefined : (value as never))}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Método de pago" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos los métodos</SelectItem>
            <SelectItem value="CONTADO">Contado</SelectItem>
            <SelectItem value="CREDITO">Crédito</SelectItem>
            <SelectItem value="CONSIGNACION">Consignación</SelectItem>
            <SelectItem value="CONTRA_ENTREGA">Contra entrega</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.buyerType ?? ALL}
          onValueChange={(value) => updateFilter("buyerType", value === ALL ? undefined : (value as never))}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Comprador" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todos</SelectItem>
            <SelectItem value="MAYORISTA">Mayorista</SelectItem>
            <SelectItem value="CLIENTE_FINAL">Cliente final</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.shippingProvince ?? ALL}
          onValueChange={(value) => updateFilter("shippingProvince", value === ALL ? undefined : value)}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Provincia" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Todas las provincias</SelectItem>
            {ECUADOR_PROVINCES.map((province) => (
              <SelectItem key={province} value={province}>
                {province}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          className="w-40"
          value={filters.dateFrom ?? ""}
          onChange={(e) => updateFilter("dateFrom", e.target.value || undefined)}
        />
        <span className="text-sm text-muted-foreground">a</span>
        <Input
          type="date"
          className="w-40"
          value={filters.dateTo ?? ""}
          onChange={(e) => updateFilter("dateTo", e.target.value || undefined)}
        />
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
