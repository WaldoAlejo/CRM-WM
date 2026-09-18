import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/context/AuthContext";
import { AlertCard } from "./components/AlertCard";
import { SalesPeriodCard } from "./components/SalesPeriodCard";
import { SalesRevenueChart } from "./components/SalesRevenueChart";
import { StockAlertsList } from "./components/StockAlertsList";
import { useDashboardSummary } from "./useDashboardSummary";

export function DashboardPage() {
  const { role } = useAuth();
  const { data, isLoading } = useDashboardSummary();

  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Los widgets de rentabilidad/cartera/reclamos NI SIQUIERA intentan
  // renderizarse para OPERATOR: no es que el backend no los mande y acá se
  // muestre un placeholder — directamente no hay JSX para ellos si
  // `data.accountsReceivable`/`data.insuranceClaims` no vinieron (mismo
  // criterio que el resto del sistema oculta por rol).
  const isAdmin = role === "ADMIN";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <AlertCard
          label="Despachos esperando al courier"
          value={data.pendingCourierShipments.count}
          highlight={data.pendingCourierShipments.count > 0}
        />
        {data.accountsReceivable ? (
          <AlertCard
            label="Cuentas por cobrar vencidas"
            value={data.accountsReceivable.overdueCount}
            subvalue={`$${data.accountsReceivable.totalOutstanding} por cobrar`}
            to="/accounts-receivable"
            highlight={data.accountsReceivable.overdueCount > 0}
          />
        ) : null}
        {data.insuranceClaims ? (
          <AlertCard
            label="Reclamos de seguro en proceso"
            value={data.insuranceClaims.pendingCount}
            to="/insurance-claims?open=true"
            highlight={data.insuranceClaims.pendingCount > 0}
          />
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <StockAlertsList count={data.stockAlerts.count} items={data.stockAlerts.items} />
        <div className="space-y-2 rounded-md border p-4">
          <h2 className="text-lg font-semibold">Ventas</h2>
          <SalesRevenueChart sales={data.sales} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SalesPeriodCard title="Hoy" period={data.sales.today} />
        <SalesPeriodCard title="Últimos 7 días" period={data.sales.week} />
        <SalesPeriodCard title="Mes en curso" period={data.sales.month} />
      </div>

      {!isAdmin ? (
        <p className="text-xs text-muted-foreground">
          Cartera vencida y reclamos de seguro son visibles solo para administradores.
        </p>
      ) : null}
    </div>
  );
}
