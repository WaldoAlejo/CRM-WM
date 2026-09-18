import { Card, CardContent } from "@/components/ui/card";
import type { PendingByCourier } from "../insuranceClaims.types";

interface PendingByCourierSummaryProps {
  pendingByCourier: PendingByCourier[];
}

// Agregado GLOBAL (no se filtra por lo que esté mirando la tabla de abajo) —
// se muestra como resumen aparte, no como una columna más del listado.
export function PendingByCourierSummary({ pendingByCourier }: PendingByCourierSummaryProps) {
  if (pendingByCourier.length === 0) return null;

  return (
    <Card>
      <CardContent className="flex flex-wrap gap-6 p-4">
        <p className="w-full text-sm font-medium text-muted-foreground">Pendiente por courier</p>
        {pendingByCourier.map((c) => (
          <div key={c.courierId}>
            <p className="text-sm text-muted-foreground">{c.courierName}</p>
            <p className="text-lg font-semibold">${c.totalPending}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
