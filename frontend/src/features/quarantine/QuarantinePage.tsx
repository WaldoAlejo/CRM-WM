import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useState } from "react";
import { DownloadDocumentButton } from "@/components/DownloadDocumentButton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAssetUrl } from "@/lib/api";
import { InspectDialog } from "./InspectDialog";
import type { QuarantineQueueLine } from "./quarantine.types";
import { useQuarantineQueue } from "./useQuarantine";

const SOURCE_LABELS: Record<QuarantineQueueLine["source"], string> = {
  CONSIGNACION: "Consignación",
  COURIER_RECHAZADO: "Courier rechazado",
};

// Bodega de Cuarentena/Validación: cola de unidades pendientes de checklist.
// La completa OPERATOR (y, por jerarquía, ADMIN/CEO). Nunca muestra precios ni
// costos. Recibe tanto lo devuelto en una liquidación de consignación como los
// envíos de courier RECHAZADOS — un solo flujo.
export function QuarantinePage() {
  const { page, setPage, query } = useQuarantineQueue();
  const [selected, setSelected] = useState<QuarantineQueueLine | null>(null);
  const lines = query.data?.data ?? [];
  const pagination = query.data?.pagination ?? null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Cuarentena / Validación</h1>
        <p className="text-sm text-muted-foreground">
          Unidades devueltas pendientes de checklist. Si pasan, vuelven a stock en su ubicación original; si no, se
          genera el cargo correspondiente.
        </p>
      </div>

      {query.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : lines.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay unidades pendientes de validación.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Origen</TableHead>
              <TableHead>Pendientes</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead>Recibido</TableHead>
              <TableHead className="w-28 text-right">Acción</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((line) => (
              <TableRow key={line.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="size-10 shrink-0 overflow-hidden rounded-md border bg-muted">
                      {line.variant.imageUrl ? (
                        <img src={getAssetUrl(line.variant.imageUrl)} alt={line.variant.productName} className="size-full object-cover" />
                      ) : null}
                    </div>
                    <div>
                      <p className="font-medium">
                        {line.variant.sku}
                        {line.variant.label ? ` — ${line.variant.label}` : ""}
                      </p>
                      <p className="text-xs text-muted-foreground">{line.variant.productName}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{SOURCE_LABELS[line.source]}</Badge>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {line.reference ?? "—"}
                    {line.wholesalerName ? ` · ${line.wholesalerName}` : ""}
                  </p>
                </TableCell>
                <TableCell className="font-medium">
                  {line.remaining} <span className="text-xs font-normal text-muted-foreground">de {line.quantity}</span>
                </TableCell>
                <TableCell className="text-sm">
                  {line.quarantineLocation
                    ? `${line.quarantineLocation.warehouse.name} · ${line.quarantineLocation.code}`
                    : "—"}
                  {line.originLocation ? (
                    <p className="text-xs text-muted-foreground">Vuelve a: {line.originLocation.code}</p>
                  ) : null}
                </TableCell>
                <TableCell className="text-sm">{new Date(line.receivedAt).toLocaleDateString("es-EC")}</TableCell>
                <TableCell className="text-right">
                  <DownloadDocumentButton path={`/returns/${line.batchId}`} filename={`devolucion-${line.batchId}`}>PDF devolución</DownloadDocumentButton>
                  <Button size="sm" onClick={() => setSelected(line)}>
                    Revisar
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>
            Página {pagination.page} de {pagination.totalPages} · {pagination.total} en total
          </span>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              <ChevronLeftIcon /> Anterior
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pagination.totalPages} onClick={() => setPage(page + 1)}>
              Siguiente <ChevronRightIcon />
            </Button>
          </div>
        </div>
      ) : null}

      <InspectDialog line={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </div>
  );
}
