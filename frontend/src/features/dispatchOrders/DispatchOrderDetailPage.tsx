import { ArrowLeftIcon } from "lucide-react";
import { DownloadDocumentButton } from "@/components/DownloadDocumentButton";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ConfirmOrderDialog } from "./components/ConfirmOrderDialog";
import { DispatchStatusBadge } from "./components/DispatchStatusBadge";
import { OrderDetailItemsTable } from "./components/OrderDetailItemsTable";
import { CollectionStatusBadge } from "./components/CollectionStatusBadge";
import { PaymentStatusBadge } from "./components/PaymentStatusBadge";
import { describeDeadline } from "./collectionStatus";
import { PaymentsSection } from "./components/PaymentsSection";
import { ShipmentSection } from "./components/ShipmentSection";
import { useDispatchOrder } from "./useDispatchOrder";
import { useDispatchOrderMutations } from "./useDispatchOrderMutations";

export function DispatchOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, isLoading } = useDispatchOrder(id);
  const { cancelMutation } = useDispatchOrderMutations();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (!order) {
    return <p className="text-muted-foreground">Orden no encontrada.</p>;
  }

  const buyerName = order.wholesaler?.businessName ?? order.finalCustomer?.fullName ?? "—";
  const isPending = order.status === "PENDIENTE";

  return (
    <div className="space-y-6">
      <Link
        to="/dispatch-orders"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline"
      >
        <ArrowLeftIcon className="size-4" /> Órdenes de despacho
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{order.orderNumber}</h1>
            <DispatchStatusBadge status={order.status} />
            <PaymentStatusBadge status={order.paymentStatus} />
            {/* Semáforo de la cuenta a crédito (el backend lo deriva al consultar). */}
            <CollectionStatusBadge status={order.collectionStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            {buyerName} ({order.buyerType === "MAYORISTA" ? "Mayorista" : "Cliente final"}) ·{" "}
            {new Date(order.createdAt).toLocaleDateString("es-EC")}
          </p>
          {order.collectionStatus && order.collectionStatus !== "COMPLETADO" && order.dueDate ? (
            <p className="text-sm text-muted-foreground">
              Vence el {new Date(order.dueDate).toLocaleDateString("es-EC")} · {describeDeadline(order.collectionStatus, order.dueDate)}
            </p>
          ) : null}
        </div>
        {isPending ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setCancelOpen(true)}>
              Cancelar
            </Button>
            <Button onClick={() => setConfirmOpen(true)}>Confirmar</Button>
          </div>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        <DownloadDocumentButton path={`/dispatch-orders/${order.id}`} filename={`despacho-${order.orderNumber}`}>
          {isPending ? "PDF orden pendiente" : order.origin && order.origin !== "NORMAL" ? "PDF cargo / liquidación" : "PDF despacho"}
        </DownloadDocumentButton>
        {order.status === "DESPACHADO" && order.origin === "NORMAL" ? (
          <DownloadDocumentButton path={`/dispatch-orders/${order.id}/warehouse-out`} filename={`salida-${order.orderNumber}`}>
            PDF salida de bodega
          </DownloadDocumentButton>
        ) : null}
        {order.shipment?.status === "RECHAZADO" ? <>
          <DownloadDocumentButton path={`/dispatch-orders/${order.id}/return`} filename={`devolucion-${order.orderNumber}`}>
            PDF devolución
          </DownloadDocumentButton>
          <DownloadDocumentButton path={`/dispatch-orders/${order.id}/return-entry`} filename={`reingreso-${order.orderNumber}`}>
            PDF reingresos aceptados
          </DownloadDocumentButton>
        </> : null}
      </div>

      <section className="grid grid-cols-2 gap-4 rounded-md border p-4 text-sm">
        <div>
          <p className="text-muted-foreground">Envío</p>
          <p>
            {order.shippingProvince}, {order.shippingCity}
          </p>
        </div>
        <div>
          <p className="text-muted-foreground">Método de pago</p>
          <p>
            {order.paymentMethod === "CONTADO"
              ? "Contado"
              : order.paymentMethod === "CREDITO"
                ? `Crédito (${order.creditDays} días)`
                : "Contra entrega"}
          </p>
        </div>
        {order.dueDate ? (
          <div>
            <p className="text-muted-foreground">Vencimiento</p>
            <p>{new Date(order.dueDate).toLocaleDateString("es-EC")}</p>
          </div>
        ) : null}
        {order.notes ? (
          <div className="col-span-2">
            <p className="text-muted-foreground">Notas</p>
            <p>{order.notes}</p>
          </div>
        ) : null}
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Ítems</h2>
        <OrderDetailItemsTable items={order.items} />
      </section>

      <PaymentsSection
        orderId={order.id}
        payments={order.payments}
        amountPaid={order.amountPaid}
        orderTotal={order.orderTotal}
      />

      {order.shipment ? <ShipmentSection orderId={order.id} shipment={order.shipment} /> : null}

      <ConfirmOrderDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        orderId={order.id}
        paymentMethod={order.paymentMethod}
      />

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Cancelar esta orden?</AlertDialogTitle>
            <AlertDialogDescription>
              Se libera el stock reservado. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancelMutation.isPending}>Volver</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                cancelMutation.mutate(order.id, { onSuccess: () => setCancelOpen(false) });
              }}
              disabled={cancelMutation.isPending}
            >
              {cancelMutation.isPending ? "Cancelando..." : "Cancelar orden"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
