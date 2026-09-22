import { Link } from "react-router-dom";
import { COLLECTION_STYLES } from "@/features/dispatchOrders/collectionStatus";
import type { CollectionStatus } from "@/features/dispatchOrders/dispatchOrders.types";
import { cn } from "@/lib/utils";
import type { DashboardSummary } from "../dashboard.types";

type ByStatus = NonNullable<NonNullable<DashboardSummary["accountsReceivable"]>["byStatus"]>;

// Los tres estados con saldo pendiente (Completado no es cartera). Mismo código
// de color que el listado y el detalle (collectionStatus.ts); los números los
// calcula el backend con el MISMO clasificador y umbral que esos dos.
const TILES: CollectionStatus[] = ["VENCIDO", "POR_VENCER", "PENDIENTE"];

export function ReceivablesTrafficLight({ byStatus }: { byStatus: ByStatus }) {
  return (
    <section aria-label="Semáforo de cartera" className="space-y-2">
      <h2 className="text-lg font-semibold">Cartera a crédito</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {TILES.map((status) => {
          const bucket = byStatus[status as keyof ByStatus];
          const style = COLLECTION_STYLES[status];
          return (
            <Link
              key={status}
              to={`/accounts-receivable?status=${status}`}
              data-collection-status={status}
              className={cn("block rounded-md border p-4 transition-colors", style.tile)}
            >
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className={cn("size-3 rounded-full", style.dot)} aria-hidden />
                {style.plural}
              </div>
              <p className="text-2xl font-semibold">{bucket.count}</p>
              <p className="text-xs text-muted-foreground">${bucket.outstanding} por cobrar</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
