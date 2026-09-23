import { WarehouseLocationSelect } from "@/features/locations/WarehouseLocationSelect";
import { ArrowLeftIcon, Trash2Icon, XIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { VariantSearchAdd } from "@/features/dispatchOrders/components/VariantSearchAdd";
import { useWholesalerOptions } from "@/features/dispatchOrders/useWholesalerOptions";
import type { SearchResult } from "@/features/search/search.types";
import type { Wholesaler } from "@/features/wholesalers/wholesalers.types";
import { ApiError } from "@/lib/api";
import { ECUADOR_PROVINCES } from "@/lib/ecuadorProvinces";
import { useCreateConsignmentLot } from "./useConsignment";

interface DraftLine {
  variantId: string;
  sku: string;
  label: string | null;
  availableStock: number;
  quantity: string;
  unitPrice: string; // vacío = precio mayorista de lista (lo resuelve el backend)
  locationId: string;
}

const NO_LOCATION = "__none__";

// La consignación SIEMPRE es a crédito y solo para mayoristas: no hay selector
// de comprador ni de método de pago. Al entregar NO se genera ningún cargo.
export function CreateConsignmentLotPage() {
  const navigate = useNavigate();
  const createMutation = useCreateConsignmentLot();

  const [wholesalerQuery, setWholesalerQuery] = useState("");
  const [wholesaler, setWholesaler] = useState<Wholesaler | null>(null);
  const [province, setProvince] = useState("");
  const [city, setCity] = useState("");
  const [creditDays, setCreditDays] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const wholesalers = useWholesalerOptions(wholesaler ? "" : wholesalerQuery);

  function handleAddLine(result: SearchResult) {
    setLines((prev) => [
      ...prev,
      {
        variantId: result.variantId,
        sku: result.sku,
        label: result.label,
        availableStock: result.availableStock,
        quantity: "1",
        unitPrice: "",
        locationId: NO_LOCATION,
      },
    ]);
  }

  function patchLine(index: number, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const days = Number(creditDays);
    if (!wholesaler) return setError("Elige un mayorista.");
    if (!province || !city.trim()) return setError("Indica provincia y ciudad de entrega.");
    if (!Number.isInteger(days) || days <= 0) return setError("Indica los días de crédito (ej. 30 o 60).");
    if (lines.length === 0) return setError("Agrega al menos un producto al lote.");
    if (lines.some((l) => !(Number.isInteger(Number(l.quantity)) && Number(l.quantity) > 0))) {
      return setError("Todas las cantidades deben ser enteros mayores a 0.");
    }
    if (lines.some((l) => l.unitPrice !== "" && !(Number(l.unitPrice) >= 0))) {
      return setError("Hay un precio inválido.");
    }

    createMutation.mutate(
      {
        wholesalerId: wholesaler.id,
        shippingProvince: province,
        shippingCity: city.trim(),
        creditDays: days,
        notes: notes.trim() || undefined,
        lines: lines.map((l) => ({
          variantId: l.variantId,
          quantity: Number(l.quantity),
          unitPrice: l.unitPrice === "" ? undefined : Number(l.unitPrice),
          locationId: l.locationId === NO_LOCATION ? undefined : l.locationId,
        })),
      },
      {
        onSuccess: (lot) => {
          toast.success(`Lote ${lot.code} entregado. No se generó ningún cargo todavía.`);
          navigate(`/consignment/${lot.id}`);
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : "No se pudo crear el lote."),
      }
    );
  }

  return (
    <div className="space-y-6">
      <Link to="/consignment" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:underline">
        <ArrowLeftIcon className="size-4" /> Consignación
      </Link>
      <h1 className="text-2xl font-semibold">Nuevo lote a consignación</h1>

      <form onSubmit={handleSubmit} className="space-y-6">
        <section className="space-y-3 rounded-md border p-4">
          <h2 className="text-lg font-semibold">Mayorista</h2>
          {wholesaler ? (
            <div className="flex items-center justify-between gap-2 rounded-md border p-2">
              <div>
                <p className="text-sm font-medium">{wholesaler.businessName}</p>
                <p className="text-xs text-muted-foreground">RUC {wholesaler.ruc}</p>
              </div>
              <Button type="button" variant="ghost" size="icon" aria-label="Quitar mayorista" onClick={() => setWholesaler(null)}>
                <XIcon />
              </Button>
            </div>
          ) : (
            <Combobox<Wholesaler>
              inputValue={wholesalerQuery}
              onInputValueChange={setWholesalerQuery}
              items={wholesalers.data}
              isLoading={wholesalers.isLoading}
              getItemKey={(w) => w.id}
              placeholder="Buscar mayorista por razón social o RUC..."
              emptyMessage={wholesalerQuery.trim() ? "Sin resultados" : "Escribe para buscar"}
              renderItem={(w) => (
                <div>
                  <p className="font-medium">{w.businessName}</p>
                  <p className="text-xs text-muted-foreground">RUC {w.ruc}</p>
                </div>
              )}
              onSelect={(w) => {
                setWholesaler(w);
                setWholesalerQuery("");
                if (w.defaultCreditDays) setCreditDays(String(w.defaultCreditDays));
              }}
            />
          )}
        </section>

        <section className="grid grid-cols-1 gap-4 rounded-md border p-4 sm:grid-cols-3">
          <h2 className="text-lg font-semibold sm:col-span-3">Entrega y crédito</h2>
          <div className="space-y-2">
            <Label htmlFor="province">Provincia</Label>
            <Select value={province} onValueChange={setProvince}>
              <SelectTrigger id="province">
                <SelectValue placeholder="Elige una provincia" />
              </SelectTrigger>
              <SelectContent>
                {ECUADOR_PROVINCES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">Ciudad</Label>
            <Input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Ej: Guayaquil" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="creditDays">Días de crédito</Label>
            <Input
              id="creditDays"
              type="number"
              min={1}
              step={1}
              value={creditDays}
              onChange={(e) => setCreditDays(e.target.value)}
              placeholder="30 o 60"
            />
          </div>
          <p className="text-xs text-muted-foreground sm:col-span-3">
            Siempre a crédito. Al entregar no se genera cargo ni cuenta por cobrar: el cobro nace al liquidar (por lo
            vendido) y la primera revisión se agenda a 20 días.
          </p>
        </section>

        <section className="space-y-3 rounded-md border p-4">
          <h2 className="text-lg font-semibold">Productos del lote</h2>
          <VariantSearchAdd existingVariantIds={new Set(lines.map((l) => l.variantId))} onAdd={handleAddLine} />
          {lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aún no hay productos.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="w-28">Cantidad</TableHead>
                  <TableHead className="w-36">Precio unitario</TableHead>
                  <TableHead>Bodega y ubicación de origen</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => {
                  const over = Number(line.quantity) > line.availableStock;
                  return (
                    <TableRow key={line.variantId}>
                      <TableCell>
                        <p className="font-medium">
                          {line.sku}
                          {line.label ? ` — ${line.label}` : ""}
                        </p>
                        <p className={over ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                          {line.availableStock} disponibles
                        </p>
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          aria-label={`Cantidad ${line.sku}`}
                          value={line.quantity}
                          onChange={(e) => patchLine(index, { quantity: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="0.01"
                          aria-label={`Precio ${line.sku}`}
                          placeholder="Lista mayorista"
                          value={line.unitPrice}
                          onChange={(e) => patchLine(index, { unitPrice: e.target.value })}
                        />
                      </TableCell>
                      <TableCell>
                        <WarehouseLocationSelect value={line.locationId === NO_LOCATION ? undefined : line.locationId} onChange={v => patchLine(index, { locationId: v ?? NO_LOCATION })} label={line.sku} disabled={createMutation.isPending} />
                      </TableCell>
                      <TableCell>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={`Quitar ${line.sku}`}
                          onClick={() => setLines((prev) => prev.filter((_, i) => i !== index))}
                        >
                          <Trash2Icon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </section>

        <div className="space-y-2">
          <Label htmlFor="notes">Notas</Label>
          <Textarea id="notes" placeholder="Opcional" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>

        {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate("/consignment")}>
            Cancelar
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? "Entregando..." : "Entregar lote"}
          </Button>
        </div>
      </form>
    </div>
  );
}
