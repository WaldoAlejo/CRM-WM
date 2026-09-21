import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { QuarantineQueueLine } from "./quarantine.types";
import { useInspectLine } from "./useQuarantine";

// Ítems FIJOS y genéricos del checklist (el "otro" es la observación libre).
const CHECK_ITEMS = [
  { key: "boxOk", label: "Caja en buen estado" },
  { key: "noVisibleDamage", label: "Producto sin daños visibles" },
  { key: "piecesComplete", label: "Piezas completas" },
] as const;
type CheckKey = (typeof CHECK_ITEMS)[number]["key"];

interface InspectDialogProps {
  line: QuarantineQueueLine | null;
  onOpenChange: (open: boolean) => void;
}

// Sin respuesta por defecto a propósito: cada ítem exige un Sí/No explícito.
// Un default "Sí" permitiría aprobar por descuido; un default "No" generaría un
// cargo indebido al mayorista o al courier. Nunca se muestran montos acá (lo
// usa OPERATOR): solo si "generará un cargo".
export function InspectDialog({ line, onOpenChange }: InspectDialogProps) {
  const mutation = useInspectLine();
  const [answers, setAnswers] = useState<Partial<Record<CheckKey, boolean>>>({});
  const [quantity, setQuantity] = useState("");
  const [observation, setObservation] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (line) {
      setAnswers({});
      setQuantity(String(line.remaining));
      setObservation("");
      setError(null);
    }
  }, [line?.id]);

  if (!line) return null;

  const allAnswered = CHECK_ITEMS.every((item) => answers[item.key] !== undefined);
  const passes = allAnswered && CHECK_ITEMS.every((item) => answers[item.key] === true);
  const chargeHint =
    line.source === "CONSIGNACION"
      ? "El mayorista pagará esta unidad como si la hubiera vendido."
      : "El courier deberá pagar el valor de venta.";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const qty = Number(quantity);
    if (!Number.isInteger(qty) || qty <= 0 || qty > line!.remaining) {
      return setError(`La cantidad debe ser un entero entre 1 y ${line!.remaining}.`);
    }
    if (!allAnswered) return setError("Responde Sí o No en los tres ítems.");

    mutation.mutate(
      {
        lineId: line!.id,
        payload: {
          quantity: qty,
          boxOk: answers.boxOk!,
          noVisibleDamage: answers.noVisibleDamage!,
          piecesComplete: answers.piecesComplete!,
          observation: observation.trim() || undefined,
        },
      },
      {
        onSuccess: (res) => {
          toast.success(
            res.inspection.result === "PASA"
              ? "Pasó el checklist: el producto volvió a stock en su ubicación original."
              : "No pasó el checklist: no vuelve a stock."
          );
          onOpenChange(false);
        },
        onError: (err) => setError(err instanceof ApiError ? err.message : "No se pudo registrar el checklist."),
      }
    );
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Checklist — {line.variant.sku}
            {line.variant.label ? ` (${line.variant.label})` : ""}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            {line.variant.productName} · {line.remaining} unidad(es) pendientes
            {line.originLocation ? ` · vuelve a ${line.originLocation.code} si pasa` : ""}
          </p>

          <div className="space-y-2">
            <Label htmlFor="inspect-qty">Unidades que estás revisando</Label>
            <Input
              id="inspect-qty"
              type="number"
              min={1}
              max={line.remaining}
              step={1}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Si parte de las unidades pasa y parte no, revisa primero un grupo y luego el otro.
            </p>
          </div>

          <div className="space-y-2">
            {CHECK_ITEMS.map((item) => (
              <div key={item.key} role="group" aria-label={item.label} className="flex items-center justify-between gap-2">
                <span className="text-sm">{item.label}</span>
                <div className="flex gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={answers[item.key] === true ? "default" : "outline"}
                    aria-pressed={answers[item.key] === true}
                    onClick={() => setAnswers((a) => ({ ...a, [item.key]: true }))}
                  >
                    Sí
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={answers[item.key] === false ? "destructive" : "outline"}
                    aria-pressed={answers[item.key] === false}
                    onClick={() => setAnswers((a) => ({ ...a, [item.key]: false }))}
                  >
                    No
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label htmlFor="inspect-obs">Otro / observación</Label>
            <Textarea id="inspect-obs" placeholder="Opcional" value={observation} onChange={(e) => setObservation(e.target.value)} />
          </div>

          {allAnswered ? (
            <p
              role="status"
              className={cn(
                "rounded-md p-2 text-sm",
                passes ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"
              )}
            >
              {passes
                ? "Resultado: PASA — el producto vuelve a stock en su ubicación original."
                : `Resultado: NO PASA — no vuelve a stock y se generará un cargo. ${chargeHint}`}
            </p>
          ) : null}

          {error ? <p className="text-sm font-medium text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={mutation.isPending || !allAnswered}>
              {mutation.isPending ? "Guardando..." : "Registrar resultado"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
