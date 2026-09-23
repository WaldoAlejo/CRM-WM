import { useState } from "react";
import { DownloadDocumentButton } from "@/components/DownloadDocumentButton";
import { EditReceiptDialog } from "./components/EditReceiptDialog";
import type { ImportBatchMovement } from "./importBatches.types";
import { cartonPlan } from '@/lib/cartonPackaging';
import { CartonPlanSummary } from './components/CartonFields';
import { hasAdminAccess } from "@/lib/roles";
import { ArrowLeftIcon } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/context/AuthContext";
import { useLocationOptions } from "@/features/locations/useLocationOptions";
import { BatchStatusBadge } from "./components/BatchStatusBadge";
import { landedUnitCost, totalBatchCost } from "./landedCost";
import { useImportBatch } from "./useImportBatches";

export function ImportBatchDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { role } = useAuth();
  const [editing, setEditing] = useState<ImportBatchMovement | null>(null);
  const isAdmin = hasAdminAccess(role);
  const { data: batch, isLoading } = useImportBatch(id);
  const { labelById } = useLocationOptions();

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!batch) return <p className="text-muted-foreground">Lote no encontrado.</p>;

  const totalUnits = batch.movements.reduce((sum, m) => sum + m.quantity, 0);
  const cartonMovements = batch.movements.filter(m => m.packaging);
  const totalCartons = cartonMovements.reduce((sum, m) => sum + m.packaging!.cartonCount, 0);
  const totalPiles = cartonMovements.reduce((sum, m) => sum + (cartonPlan(m.packaging!, Number(m.volumeCbm))?.piles ?? 0), 0);
  // Costos: solo ADMIN (el backend ni manda unitCost/landedCostPerUnit ni los
  // 3 costos del lote a OPERATOR) — nada de esto se dibuja para OPERATOR.
  const originTotal = batch.movements.reduce((sum, m) => sum + m.quantity * (Number(m.unitCost) || 0), 0);
  const landedTotal = batch.movements.reduce(
    (sum, m) => sum + m.quantity * ((Number(m.unitCost) || 0) + (Number(m.landedCostPerUnit) || 0)),
    0
  );
  const batchCost = totalBatchCost({
    freightCost: Number(batch.freightCost) || 0,
    customsCost: Number(batch.customsCost) || 0,
    otherCosts: Number(batch.otherCosts) || 0,
  });

  const summary: { label: string; value: string }[] = [
    { label: "Modalidad / volumen", value: batch.containerType ? `${batch.containerType === "LCL" ? "Carga suelta / LCL" : batch.containerType === "40HC" ? "40 HC" : `${batch.containerType} pies`} · ${batch.containerCbm} CBM` : "Histórico sin CBM" },
    { label: "CBM recibidos", value: batch.movements.reduce((sum, m) => sum + Number(m.volumeCbm ?? 0), 0).toFixed(6) },
    { label: "Unidades recibidas", value: String(totalUnits) },
    { label: 'Cartones registrados', value: String(totalCartons) },
    { label: 'Pilas estimadas de ingresos', value: String(totalPiles) },
    ...(isAdmin
      ? [
          { label: "Costo por CBM (USD)", value: Number(batch.containerCbm) > 0 ? `${(batchCost / Number(batch.containerCbm)).toFixed(2)}` : "—" },
          { label: "Costos del lote", value: `$${batchCost.toFixed(2)}` },
          { label: "Total en origen", value: `$${originTotal.toFixed(2)}` },
          { label: "Total puesto en bodega", value: `$${landedTotal.toFixed(2)}` },
        ]
      : []),
  ];

  return (
    <div className="space-y-6">
      <Link to="/import-batches" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeftIcon className="size-4" /> Importaciones
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-semibold">{batch.reference}</h1>
            <BatchStatusBadge movementsCount={batch.movements.length} />
          </div>
          <p className="text-sm text-muted-foreground">
            Llegada {new Date(batch.arrivalDate).toLocaleDateString("es-EC", { timeZone: "UTC" })} · Proveedor{" "}
            {batch.supplier?.name ?? "—"}
          </p>
          {batch.notes ? <p className="mt-1 text-sm">{batch.notes}</p> : null}
        </div>
        <Button asChild>
          <Link to={`/import-batches/${batch.id}/receive`}>Recibir mercadería</Link>
        </Button>
      </div>

      {batch.movements.length > 0 ? <DownloadDocumentButton path={`/import-batches/${batch.id}`} filename={`ingresos-${batch.reference}`}>
        PDF ingresos de bodega
      </DownloadDocumentButton> : null}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {summary.map((card) => (
          <Card key={card.label}>
            <CardContent className="p-4">
              <p className="text-sm text-muted-foreground">{card.label}</p>
              <p className="text-xl font-semibold">{card.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Movimientos de ingreso</h2>
        <p className="text-xs text-muted-foreground">Cartones y pilas corresponden a ingresos con empaque registrado, por separado. Son una planificación inicial; no descuentan despachos ni verifican la altura disponible.</p>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Producto</TableHead>
              <TableHead>Ubicación</TableHead>
              <TableHead>Cantidad</TableHead><TableHead>CBM</TableHead>
              {isAdmin ? (
                <>
                  <TableHead>Costo en origen</TableHead>
                  <TableHead>Prorrateo / unidad</TableHead>
                  <TableHead>Costo puesto / unidad</TableHead>

                  <TableHead>Precio de venta</TableHead>
                </>
              ) : null}
              <TableHead>Fecha</TableHead><TableHead>Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batch.movements.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isAdmin ? 10 : 6} className="h-20 text-center text-muted-foreground">
                  Este lote todavía no recibió mercadería.
                </TableCell>
              </TableRow>
            ) : (
              batch.movements.map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <p className="font-medium">{m.variant.sku}</p>
                    {m.variant.label ? <p className="text-xs text-muted-foreground">{m.variant.label}</p> : null}
                    {m.packaging ? <details className="mt-2 min-w-56 text-xs"><summary className="cursor-pointer">{m.packaging.cartonCount} cartones × {m.packaging.unitsPerCarton} unidades · ver apilamiento</summary><CartonPlanSummary packaging={m.packaging} volumeCbm={m.volumeCbm == null ? null : Number(m.volumeCbm)} /></details> : <p className="text-xs text-muted-foreground">Empaque por cartón sin registrar</p>}
                  </TableCell>
                  <TableCell>{m.toLocationId ? (labelById.get(m.toLocationId) ?? "Ubicación eliminada") : "—"}</TableCell>
                  <TableCell>{m.quantity}</TableCell><TableCell>{m.volumeCbm ?? "—"}</TableCell>
                  {isAdmin ? (
                    <>
                      <TableCell>${Number(m.unitCost ?? 0).toFixed(2)}</TableCell>
                      <TableCell>${Number(m.landedCostPerUnit ?? 0).toFixed(2)}</TableCell>
                      <TableCell className="font-medium">
                        ${landedUnitCost(Number(m.unitCost) || 0, Number(m.landedCostPerUnit) || 0).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Link to="/dispatch-orders/new" className="underline">Negociar en despacho</Link>
                      </TableCell>
                    </>
                  ) : null}
                  <TableCell>{new Date(m.createdAt).toLocaleString("es-EC")}</TableCell>
                  <TableCell><div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => setEditing(m)}>Editar ubicación y dimensiones</Button>
                    <DownloadDocumentButton path={`/movements/${m.id}`} filename={`ingreso-${m.id}`}>PDF ingreso</DownloadDocumentButton>
                  </div></TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </section>
      {editing && <EditReceiptDialog batchId={batch.id} movement={editing} onClose={() => setEditing(null)} />}


    </div>
  );
}
