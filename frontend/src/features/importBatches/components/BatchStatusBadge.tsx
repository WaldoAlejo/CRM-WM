import { Badge } from "@/components/ui/badge";

// El modelo no tiene un campo "estado": se deriva de si el lote ya generó
// movimientos de ingreso (movementsCount > 0) o todavía no se recibió nada.
export function BatchStatusBadge({ movementsCount }: { movementsCount: number }) {
  return movementsCount > 0 ? (
    <Badge>Recibido</Badge>
  ) : (
    <Badge variant="secondary">Pendiente de recepción</Badge>
  );
}
