import { ArrowLeftIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { Skeleton } from "@/components/ui/skeleton";
import { PendingClaimSalesSection } from "./components/PendingClaimSalesSection";
import { ProfitabilityDateFilter } from "./components/ProfitabilityDateFilter";
import { ProfitabilityLinesTable } from "./components/ProfitabilityLinesTable";
import { TotalsSummaryCards } from "./components/TotalsSummaryCards";
import { useDateRangeParams } from "./useDateRangeParams";
import { useProfitabilityReport } from "./useProfitabilityReport";

// ADMIN-only: gateado en el router (RequireRole), espejo de
// requireRole(Role.ADMIN) real en reports.routes.ts.
export function ProfitabilityDetailPage() {
  const { from, to, setRange } = useDateRangeParams();
  const { data, isLoading } = useProfitabilityReport(from, to);

  return (
    <div className="space-y-4">
      <Link to="/reports" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeftIcon className="size-4" /> Rentabilidad
      </Link>

      <h1 className="text-2xl font-semibold">Rentabilidad — detalle por producto</h1>

      <ProfitabilityDateFilter from={from} to={to} onChange={setRange} />

      {isLoading || !data ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (
        <>
          <TotalsSummaryCards totals={data.totals} />

          <section className="space-y-2">
            <h2 className="text-lg font-semibold">Ventas</h2>
            <ProfitabilityLinesTable lines={data.lines} />
          </section>

          <PendingClaimSalesSection
            lines={data.ventasConReclamoPendiente.lines}
            totals={data.ventasConReclamoPendiente.totals}
          />
        </>
      )}
    </div>
  );
}
