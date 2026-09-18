import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { SalesPeriod } from "../dashboard.types";

// `period.profit` viene UNDEFINED para OPERATOR (el backend ni siquiera lo
// calcula, ver dashboard.service.ts) — no se intenta renderizar esa parte en
// vez de mostrar "$0" o vacío.
export function SalesPeriodCard({ title, period }: { title: string; period: SalesPeriod }) {
  const hasProfit = period.profit !== undefined;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1">
        <p className="text-2xl font-semibold">${period.totalRevenue}</p>
        <p className="text-sm text-muted-foreground">{period.unitsSold} unidades</p>
        {hasProfit ? (
          <p className="text-sm text-muted-foreground">
            Ganancia: ${period.profit} ({period.profitMarginPct}%)
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
