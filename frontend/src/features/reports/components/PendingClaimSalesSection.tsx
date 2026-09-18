import type { ProfitabilityLine, ProfitabilityTotals } from "../reports.types";
import { ProfitabilityLinesTable } from "./ProfitabilityLinesTable";

interface PendingClaimSalesSectionProps {
  lines: ProfitabilityLine[];
  totals: ProfitabilityTotals;
}

// Visualmente separada del reporte principal a propósito (borde/fondo
// distinto, título propio, su propio subtotal) — espejo de
// ventasConReclamoPendiente en reports.service.ts: NUNCA se suma al total
// de arriba, ni acá ni en el backend.
export function PendingClaimSalesSection({ lines, totals }: PendingClaimSalesSectionProps) {
  if (lines.length === 0) return null;

  return (
    <section className="space-y-3 rounded-md border-2 border-amber-300 bg-amber-50 p-4">
      <div>
        <h2 className="text-lg font-semibold text-amber-900">Ventas con reclamo pendiente</h2>
        <p className="text-sm text-amber-800">
          Shipment perdido/dañado con reclamo todavía sin pagar — no cuenta para el total principal hasta que se
          resuelva.
        </p>
      </div>
      <ProfitabilityLinesTable lines={lines} />
      <p className="text-right text-sm font-medium text-amber-900">
        Subtotal pendiente: ${totals.totalRevenue} revenue · ${totals.profit} ganancia potencial
      </p>
    </section>
  );
}
