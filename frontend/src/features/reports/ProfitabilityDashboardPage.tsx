import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CategoryProfitChart } from "./components/CategoryProfitChart";
import { ProfitabilityDateFilter } from "./components/ProfitabilityDateFilter";
import { TopProductsTable } from "./components/TopProductsTable";
import { TotalsSummaryCards } from "./components/TotalsSummaryCards";
import { useDateRangeParams } from "./useDateRangeParams";
import { useProfitabilitySummary } from "./useProfitabilitySummary";

// ADMIN-only: gateado en el router (RequireRole), espejo de
// requireRole(Role.ADMIN) real en reports.routes.ts.
export function ProfitabilityDashboardPage() {
  const { from, to, setRange } = useDateRangeParams();
  const { data, isLoading } = useProfitabilitySummary(from, to);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Rentabilidad</h1>
        <Button asChild variant="outline">
          <Link to={`/reports/profitability?from=${from}&to=${to}`}>Ver detalle →</Link>
        </Button>
      </div>

      <ProfitabilityDateFilter from={from} to={to} onChange={setRange} />

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <TotalsSummaryCards totals={data.totals} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="space-y-2 rounded-md border p-4">
              <h2 className="text-lg font-semibold">Ganancia por categoría</h2>
              <CategoryProfitChart byCategory={data.byCategory} />
            </div>
            <div className="space-y-2 rounded-md border p-4">
              <h2 className="text-lg font-semibold">Top 10 productos por ganancia</h2>
              <TopProductsTable products={data.topProductsByProfit} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
