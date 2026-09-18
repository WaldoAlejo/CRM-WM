import { DownloadIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiError, getAssetUrl } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useChinaRequestLowStock, useDownloadChinaRequestPdf } from "./useChinaRequest";

// Exclusivo de CEO: gateado en el router (RequireRole roles={["CEO"]}) y en
// el backend (requireRole(Role.CEO) en el PDF). Ningún dato de costo/precio
// existe en esta pantalla — la lista que llega del backend no los trae.
// La selección vive solo acá (estado local): no se guarda, no toca stock.
export function ChinaRequestPage() {
  const { data, isLoading } = useChinaRequestLowStock();
  const downloadMutation = useDownloadChinaRequestPdf();
  // variantId → cantidad (string, para poder editarla libremente antes de validar).
  const [selection, setSelection] = useState<Record<string, string>>({});

  const lines = data?.data ?? [];
  const selectedIds = Object.keys(selection);
  const invalidIds = selectedIds.filter((id) => !(Number.isInteger(Number(selection[id])) && Number(selection[id]) > 0));
  const canDownload = selectedIds.length > 0 && invalidIds.length === 0 && !downloadMutation.isPending;

  function toggle(variantId: string, checked: boolean) {
    setSelection((prev) => {
      const next = { ...prev };
      if (checked) next[variantId] = "1";
      else delete next[variantId];
      return next;
    });
  }

  function handleDownload() {
    downloadMutation.mutate(
      selectedIds.map((variantId) => ({ variantId, quantity: Number(selection[variantId]) })),
      {
        onSuccess: () => toast.success("PDF generado"),
        onError: (error) =>
          toast.error(error instanceof ApiError ? error.message : "No se pudo generar el PDF. Intenta de nuevo."),
      }
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Solicitud a Proveedor</h1>
          <p className="text-sm text-muted-foreground">
            Productos con stock menor a {data?.threshold ?? 10} unidades. Marca los que quieres pedir e indica la
            cantidad; el PDF incluye imagen, descripción y cantidad — sin costos.
          </p>
        </div>
        <Button onClick={handleDownload} disabled={!canDownload}>
          <DownloadIcon /> Descargar PDF{selectedIds.length > 0 ? ` (${selectedIds.length})` : ""}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full" />
          ))}
        </div>
      ) : lines.length === 0 ? (
        <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay productos con stock bajo.
        </p>
      ) : (
        <>
          {data && data.total > lines.length ? (
            <p className="text-xs text-muted-foreground">
              Mostrando {lines.length} de {data.total} (los de menor stock primero).
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lines.map((line) => {
              const checked = line.variantId in selection;
              const invalid = invalidIds.includes(line.variantId);
              const imageUrl = line.imageUrl ? getAssetUrl(line.imageUrl) : null;
              return (
                <Card key={line.variantId} className={cn(checked && "border-primary")}>
                  <CardContent className="flex gap-3 p-4">
                    <div className="size-24 shrink-0 overflow-hidden rounded-md border bg-muted">
                      {imageUrl ? (
                        <img src={imageUrl} alt={line.productName} className="size-full object-cover" />
                      ) : (
                        <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                          Sin imagen
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <label className="flex cursor-pointer items-start gap-2">
                        <input
                          type="checkbox"
                          className="mt-1 size-4"
                          checked={checked}
                          aria-label={`Seleccionar ${line.productName}${line.variantLabel ? ` ${line.variantLabel}` : ""}`}
                          onChange={(e) => toggle(line.variantId, e.target.checked)}
                        />
                        <span className="font-medium leading-tight">
                          {line.productName}
                          {line.variantLabel ? ` — ${line.variantLabel}` : ""}
                        </span>
                      </label>
                      {line.description ? (
                        <p className="line-clamp-3 text-sm text-muted-foreground">{line.description}</p>
                      ) : null}
                      <p className="text-xs text-muted-foreground">Stock actual: {line.stock}</p>
                      {checked ? (
                        <div className="flex items-center gap-2 pt-1">
                          <span className="text-sm">Cantidad</span>
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            className={cn("h-8 w-24", invalid && "border-destructive")}
                            aria-label={`Cantidad a pedir ${line.productName}${line.variantLabel ? ` ${line.variantLabel}` : ""}`}
                            value={selection[line.variantId]}
                            onChange={(e) => setSelection((prev) => ({ ...prev, [line.variantId]: e.target.value }))}
                          />
                        </div>
                      ) : null}
                      {invalid ? <p className="text-xs text-destructive">Ingresa un entero mayor a 0.</p> : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
