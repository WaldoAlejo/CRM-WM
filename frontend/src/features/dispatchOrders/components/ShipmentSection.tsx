import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Shipment } from "../dispatchOrders.types";
import { DeliverShipmentDialog } from "./DeliverShipmentDialog";
import { LostOrDamagedShipmentDialog } from "./LostOrDamagedShipmentDialog";
import { RejectShipmentDialog } from "./RejectShipmentDialog";

const STATUS_LABELS: Record<Shipment["status"], string> = {
  EN_TRANSITO: "En tránsito",
  ENTREGADO: "Entregado",
  RECHAZADO: "Rechazado",
  PERDIDO: "Perdido",
  DANADO: "Dañado",
};

interface ShipmentSectionProps {
  orderId: string;
  shipment: Shipment;
}

// Los 3 botones de acción son de cualquier rol autenticado (reportar lo que
// dice el courier es tarea de bodega/logística — ver el comentario de
// shipments.routes.ts), y solo aparecen si el envío sigue EN_TRANSITO: una
// vez que el courier ya entregó/rechazó/perdió, esas 3 acciones dejan de
// tener sentido (el backend las rechaza con 409 fuera de ese estado).
export function ShipmentSection({ orderId, shipment }: ShipmentSectionProps) {
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [lostOrDamagedOpen, setLostOrDamagedOpen] = useState(false);
  const inTransit = shipment.status === "EN_TRANSITO";

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">Envío</h2>
        <Badge variant={shipment.status === "ENTREGADO" ? "default" : "secondary"}>
          {STATUS_LABELS[shipment.status]}
        </Badge>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Courier</dt>
          <dd>{shipment.courier.name}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Guía</dt>
          <dd>{shipment.trackingNumber ?? "—"}</dd>
        </div>
        {shipment.isCOD ? (
          <>
            <div>
              <dt className="text-muted-foreground">COD esperado</dt>
              <dd>${shipment.codAmountExpected ?? "0.00"}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">COD cobrado</dt>
              <dd>{shipment.codAmountCollected ? `$${shipment.codAmountCollected}` : "—"}</dd>
            </div>
          </>
        ) : null}
        {shipment.rejectionReason ? (
          <div className="col-span-2">
            <dt className="text-muted-foreground">Motivo de rechazo</dt>
            <dd>{shipment.rejectionReason}</dd>
          </div>
        ) : null}
      </dl>

      {shipment.claim ? (
        <p className="rounded-md bg-amber-50 p-2 text-sm text-amber-800">
          Reclamo de seguro generado — estado: {shipment.claim.status}, monto: ${shipment.claim.claimAmount}
        </p>
      ) : null}

      {inTransit ? (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setDeliverOpen(true)}>
            Marcar entregado
          </Button>
          <Button size="sm" variant="outline" onClick={() => setRejectOpen(true)}>
            Marcar rechazado
          </Button>
          <Button size="sm" variant="outline" onClick={() => setLostOrDamagedOpen(true)}>
            Marcar perdido/dañado
          </Button>
        </div>
      ) : null}

      <DeliverShipmentDialog
        open={deliverOpen}
        onOpenChange={setDeliverOpen}
        orderId={orderId}
        shipmentId={shipment.id}
      />
      <RejectShipmentDialog
        open={rejectOpen}
        onOpenChange={setRejectOpen}
        orderId={orderId}
        shipmentId={shipment.id}
      />
      <LostOrDamagedShipmentDialog
        open={lostOrDamagedOpen}
        onOpenChange={setLostOrDamagedOpen}
        orderId={orderId}
        shipmentId={shipment.id}
      />
    </section>
  );
}
