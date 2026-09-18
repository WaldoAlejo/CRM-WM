// Regla única de "¿esta línea despachada cuenta como venta real?", compartida
// entre el reporte de rentabilidad (reports.service.ts) y el resumen del
// Dashboard (dashboard.service.ts) — ninguno de los dos debe reimplementarla,
// para que "ventas" signifique siempre lo mismo en todo el sistema.
import { ClaimStatus, ShipmentStatus } from "@prisma/client";

export type SaleClassification = "SOLD" | "PENDING_CLAIM" | "EXCLUDED";

interface ClassifiableShipment {
  status: ShipmentStatus;
  claim?: { status: ClaimStatus } | null;
}

// EXCLUDED: el courier RECHAZÓ la entrega — el producto volvió a bodega
// entero, nunca hubo venta.
// PENDING_CLAIM: el courier PERDIÓ/DAÑÓ el envío y el reclamo todavía no
// está PAGADO — no se cuenta como venta concretada hasta que se resuelva.
// SOLD: cualquier otro caso (entregado, en tránsito, sin envío/courier —
// venta CONTADO normal, o reclamo ya PAGADO).
export function classifySaleByShipment(shipment: ClassifiableShipment | null | undefined): SaleClassification {
  if (shipment?.status === ShipmentStatus.RECHAZADO) return "EXCLUDED";

  const isLostOrDamaged = shipment?.status === ShipmentStatus.PERDIDO || shipment?.status === ShipmentStatus.DANADO;
  if (isLostOrDamaged && shipment?.claim?.status !== ClaimStatus.PAGADO) return "PENDING_CLAIM";

  return "SOLD";
}
