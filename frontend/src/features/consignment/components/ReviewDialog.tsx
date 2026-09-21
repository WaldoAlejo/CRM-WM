import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import type { ConsignmentLotDetail } from "../consignment.types";
import { useCreateReview } from "../useConsignment";

interface ReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lot: ConsignmentLotDetail;
}

type Draft = Record<string, { sold: string; returned: string }>;

const toInt = (value: string) => (value.trim() === "" ? 0 : Number(value));
const isValidInt = (value: string) => Number.isInteger(toInt(value)) && toInt(value) >= 0;

// Revisión de un lote: EXTENDER (sin cargo, +20 días desde hoy) o LIQUIDAR
// (parcial las veces que haga falta: cobra solo lo vendido y manda lo
// devuelto a Cuarentena). El mayorista reporta SKU por SKU.
export function ReviewDialog({ open, onOpenChange, lot }: ReviewDialogProps) {
  const mutation = useCreateReview(lot.id);
  const [action, setAction] = useState<"EXTENDER" | "LIQUIDAR">("LIQUIDAR");
  const [notes, setNotes] = useState("");
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setAction("LIQUIDAR");
      setNotes("");
      setError(null);
      setDraft(Object.fromEntries(lot.lines.map((l) => [l.id, { sold: "0", returned: "0" }])));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lot.id]);

  const openLines = lot.lines.filter((l) => l.pending > 0);

  function patch(lineId: string, key: "sold" | "returned", value: string) {
    setDraft((prev) => ({ ...prev, [lineId]: { ...prev[lineId], [key]: value } }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (action === "EXTENDER") {
      mutation.mutate(
        { action: "EXTENDER", notes: notes.trim() || undefined },
        {
          onSuccess: () => {
            toast.success("Plazo extendido 20 días. No se generó ningún cargo.");
            onOpenChange(false);
          },
          onError: (err) => setError(err instanceof ApiError ? err.message : "No se pudo registrar la revisión."),
        }
      );
      return;
    }

    const lines = [];
    for (const line of openLines) {
      const d = draft[line.id] ?? { sold: "0", returned: "0" };
      if (!isValidInt(d.sold) || !isValidInt(d.returned)) {
        return setError(`Cantidades inválidas en ${line.sku}: usa enteros de 0 en adelante.`);
      }
      const sold = toInt(d.sold);
      const returned = toInt(d.returned);
      if (sold + returned > line.pending) {
        return setError(`En ${line.sku}, vendidas + devueltas (${sold + returned}) superan lo pendiente (${line.pending}).`);
      }
      if (sold + returned > 0) lines.push({ lineId: line.id, quantitySold: sold, quantityReturned: returned });
    }
    if (lines.length === 0) return setError("Reporta al menos una unidad vendida o devuelta para liquidar.");

    mutation.mutate(
      { action: "LIQUIDAR", notes: notes.trim() || undefined, lines },
      {
        onSuccess: (res) => {
          toast.success(
            res.lot.status === "CERRADO" ? "Liquidación registrada: el lote quedó cerrado." : "Liquidación parcial registrada."
          );
          onOpenChange(false);
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : "No se pudo registrar la liquidación."),
      }
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revisión del lote {lot.code}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <div className="flex gap-2">
            <Button type="button" variant={action === "LIQUIDAR" ? "default" : "outline"} onClick={() => setAction("LIQUIDAR")}>
              Liquidar
            </Button>
            <Button type="button" variant={action === "EXTENDER" ? "default" : "outline"} onClick={() => setAction("EXTENDER")}>
              Extender plazo
            </Button>
          </div>

          {action === "EXTENDER" ? (
            <p className="text-sm text-muted-foreground">
              El mayorista necesita más tiempo: no hay cargo, el lote sigue abierto y la siguiente revisión se agenda a{" "}
              {lot.reviewIntervalDays} días desde hoy.
            </p>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Reporta por producto cuánto vendió y cuánto devuelve. Se cobra a crédito ({lot.creditDays} días) solo lo
                vendido; lo devuelto pasa a Cuarentena para validación. Lo no reportado sigue en consignación.
              </p>
              <div className="grid grid-cols-[1fr_5rem_6rem_6rem] items-center gap-2 text-sm font-medium">
                <span>Producto</span>
                <span>Pendiente</span>
                <span>Vendidas</span>
                <span>Devueltas</span>
              </div>
              {openLines.map((line) => (
                <div key={line.id} className="grid grid-cols-[1fr_5rem_6rem_6rem] items-center gap-2">
                  <span className="truncate text-sm">
                    {line.sku}
                    {line.label ? ` — ${line.label}` : ""}
                  </span>
                  <span className="text-sm text-muted-foreground">{line.pending}</span>
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    aria-label={`Vendidas ${line.sku}`}
                    value={draft[line.id]?.sold ?? "0"}
                    onChange={(e) => patch(line.id, "sold", e.target.value)}
                  />
                  <Input
                    type="number"
                    min={0}
                    step={1}
                    aria-label={`Devueltas ${line.sku}`}
                    value={draft[line.id]?.returned ?? "0"}
                    onChange={(e) => patch(line.id, "returned", e.target.value)}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="review-notes">Notas</Label>
            <Textarea
              id="review-notes"
              placeholder="Opcional: con quién hablaste, qué acordaron"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending}>
              {mutation.isPending ? "Guardando..." : action === "LIQUIDAR" ? "Registrar liquidación" : "Extender plazo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
