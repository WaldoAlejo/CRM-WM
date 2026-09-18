import { Card, CardContent } from "@/components/ui/card";
import type { ProfitabilityTotals } from "../reports.types";

// Puramente presentacional: cada valor se muestra tal cual llega de la API
// (unitCostSnapshot/landedCostSnapshot ya congelados) — nada se recalcula acá.
export function TotalsSummaryCards({ totals }: { totals: ProfitabilityTotals }) {
  const cards = [
    { label: "Revenue", value: `$${totals.totalRevenue}` },
    { label: "Costo", value: `$${totals.totalCost}` },
    { label: "Ganancia", value: `$${totals.profit}` },
    { label: "Margen", value: `${totals.profitMarginPct}%` },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">{card.label}</p>
            <p className="text-2xl font-semibold">{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
