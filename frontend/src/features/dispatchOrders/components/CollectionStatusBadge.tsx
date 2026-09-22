import { Badge } from "@/components/ui/badge";
import { COLLECTION_STYLES } from "../collectionStatus";
import type { CollectionStatus } from "../dispatchOrders.types";

// Badge del semáforo (verde / gris-azul / ámbar / rojo). `null` (la orden no es
// un crédito despachado) no pinta nada.
export function CollectionStatusBadge({ status }: { status: CollectionStatus | null }) {
  if (!status) return null;
  const style = COLLECTION_STYLES[status];
  return (
    <Badge variant="outline" className={style.badge} data-collection-status={status}>
      {style.label}
    </Badge>
  );
}
