import { ArrowLeftIcon } from "lucide-react";
import { DownloadDocumentButton } from "@/components/DownloadDocumentButton";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ConsignmentStatusBadge } from "./components/ConsignmentStatusBadge";
import { ReviewDialog } from "./components/ReviewDialog";
import { useConsignmentLot } from "./useConsignment";

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("es-EC");

export function ConsignmentDetailPage() {
  const { id } = useParams();
  const { data: lot, isLoading } = useConsignmentLot(id);
  const [reviewOpen, setReviewOpen] = useState(false);

  if (isLoading || !lot) return <Skeleton className="h-64 w-full" />;

  const closed = lot.status === "CERRADO";
  const skuById = new Map(lot.lines.map((l) => [l.id, l.sku]));

  return (
    <div className="space-y-6">
      <Link to="/consignment" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeftIcon className="size-4" /> Consignación
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{lot.code}</h1>
            <ConsignmentStatusBadge status={lot.displayStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            {lot.wholesaler.businessName} · entregado el {fmtDate(lot.deliveredAt)} · crédito {lot.creditDays} días ·{" "}
            {lot.shippingCity}, {lot.shippingProvince}
          </p>
          {!closed ? (
            <p className={lot.isReviewOverdue ? "text-sm font-medium text-destructive" : "text-sm text-muted-foreground"}>
              {lot.isReviewOverdue ? "Revisión vencida desde el " : "Próxima revisión: "}
              {fmtDate(lot.nextReviewDate)}
            </p>
          ) : null}
        </div>
        {!closed ? <Button onClick={() => setReviewOpen(true)}>Registrar revisión</Button> : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {lot.dispatchOrderId ? <Button variant="outline" asChild><Link to={`/dispatch-orders/${lot.dispatchOrderId}`}>Ver despacho de origen</Link></Button> : null}
        <DownloadDocumentButton path={`/consignments/${lot.id}`} filename={`consignacion-${lot.code}`}>PDF consignación</DownloadDocumentButton>
        <DownloadDocumentButton path={`/consignments/${lot.id}/warehouse-out`} filename={`salida-${lot.code}`}>PDF salida de bodega</DownloadDocumentButton>
      </div>

      {lot.isReviewOverdue ? (
        <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          El mayorista no respondió en la fecha de revisión. No se liquida ni se extiende sola: contáctalo y registra
          qué pasó.
        </p>
      ) : null}

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Productos</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Precio</TableHead>
              <TableHead>Entregadas</TableHead>
              <TableHead>Vendidas</TableHead>
              <TableHead>Devueltas</TableHead>
              <TableHead>Pendientes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lot.lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  <p className="font-medium">
                    {line.sku}
                    {line.label ? ` — ${line.label}` : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{line.productName}</p>
                </TableCell>
                <TableCell>${line.unitPrice}</TableCell>
                <TableCell>{line.quantityDelivered}</TableCell>
                <TableCell>{line.sold}</TableCell>
                <TableCell>{line.returned}</TableCell>
                <TableCell className="font-medium">{line.pending}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Historial de revisiones</h2>
        {lot.reviews.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no hay revisiones.</p>
        ) : (
          <ul className="space-y-2">
            {lot.reviews.map((r) => (
              <li key={r.id} className="rounded-md border p-3 text-sm">
                <div className="mb-2 flex flex-wrap gap-2">
                  <DownloadDocumentButton path={`/reviews/${r.id}`} filename={`revision-${lot.code}-${r.id}`}>PDF revisión</DownloadDocumentButton>
                  {r.returnBatch ? <>
                    <DownloadDocumentButton path={`/returns/${r.returnBatch.id}`} filename={`devolucion-${r.returnBatch.id}`}>PDF devolución</DownloadDocumentButton>
                    <DownloadDocumentButton path={`/returns/${r.returnBatch.id}/warehouse-in`} filename={`reingreso-${r.returnBatch.id}`}>PDF reingresos aceptados</DownloadDocumentButton>
                  </> : null}
                </div>
                <p className="font-medium">
                  {fmtDate(r.reviewedAt)} — {r.action === "LIQUIDAR" ? "Liquidación" : "Extensión de plazo"}
                </p>
                {r.lines.length > 0 ? (
                  <p className="text-muted-foreground">
                    {r.lines
                      .map((l) => `${skuById.get(l.lineId) ?? "?"}: ${l.quantitySold} vendidas, ${l.quantityReturned} devueltas`)
                      .join(" · ")}
                  </p>
                ) : null}
                {r.chargeOrder ? (
                  <p>
                    Cargo por lo vendido:{" "}
                    <Link to={`/dispatch-orders/${r.chargeOrder.id}`} className="font-medium hover:underline">
                      {r.chargeOrder.orderNumber}
                    </Link>
                  </p>
                ) : null}
                {r.returnBatch ? (
                  <p className="text-muted-foreground">
                    Devolución en Cuarentena: {r.returnBatch.completedAt ? "validada" : "pendiente de checklist"}
                    {r.returnBatch.chargeOrder ? (
                      <>
                        {" · cargo por no conformes: "}
                        <Link to={`/dispatch-orders/${r.returnBatch.chargeOrder.id}`} className="font-medium hover:underline">
                          {r.returnBatch.chargeOrder.orderNumber}
                        </Link>
                      </>
                    ) : null}
                  </p>
                ) : null}
                {r.notes ? <p className="text-muted-foreground">“{r.notes}”</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ReviewDialog open={reviewOpen} onOpenChange={setReviewOpen} lot={lot} />
    </div>
  );
}
