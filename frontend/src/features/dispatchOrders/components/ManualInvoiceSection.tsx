import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { apiFetch } from "@/lib/api";
import type { DispatchOrderDetail } from "../dispatchOrders.types";

// Facturación manual: mientras no hay emisor electrónico activo la factura se
// emite fuera del sistema y aquí solo se registra su número para cobranza.
export function ManualInvoiceSection({ order }: { order: Pick<DispatchOrderDetail, "id" | "status" | "manualInvoiceNumber"> }) {
  const queryClient = useQueryClient();
  const current = order.manualInvoiceNumber ?? null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (manualInvoiceNumber: string) =>
      apiFetch<{ manualInvoiceNumber: string | null }>(`/dispatch-orders/${order.id}/manual-invoice`, {
        method: "PATCH",
        body: JSON.stringify({ manualInvoiceNumber }),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["dispatchOrders"] });
      queryClient.invalidateQueries({ queryKey: ["accountsReceivable"] });
      setEditing(false);
      setError(null);
      toast.success(result.manualInvoiceNumber ? `Factura ${result.manualInvoiceNumber} registrada` : "Número de factura quitado");
    },
    onError: (e) => setError(e instanceof Error ? e.message : "No se pudo guardar la factura"),
  });

  const showForm = editing || !current;
  const dispatched = order.status === "DESPACHADO";

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Factura</h2>
        {current && !editing ? (
          <Button variant="outline" size="sm" onClick={() => { setValue(current); setEditing(true); }}>
            Cambiar
          </Button>
        ) : null}
      </div>
      {current && !editing ? (
        <p className="text-sm">
          N.º <span className="whitespace-nowrap font-medium">{current}</span> · emitida fuera del sistema
        </p>
      ) : (
        <p className={dispatched && !current ? "text-sm text-amber-700" : "text-sm text-muted-foreground"}>
          {dispatched
            ? "Emite la factura (con IVA) y registra aquí su número para el seguimiento de cobro."
            : "Puedes registrar el número ahora o después de confirmar la orden."}
        </p>
      )}
      {showForm ? (
        <form
          className="flex flex-wrap items-start gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate(value);
          }}
        >
          <div className="min-w-0 flex-1 basis-56 space-y-1">
            <Input
              aria-label="Número de factura"
              placeholder="001-001-000000123"
              inputMode="numeric"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
          </div>
          <Button type="submit" disabled={mutation.isPending || !value.trim()}>
            {mutation.isPending ? "Guardando..." : "Guardar"}
          </Button>
          {editing ? (
            <>
              <Button type="button" variant="outline" onClick={() => { setEditing(false); setError(null); }}>
                Cancelar
              </Button>
              <Button type="button" variant="ghost" disabled={mutation.isPending} onClick={() => mutation.mutate("")}>
                Quitar número
              </Button>
            </>
          ) : null}
        </form>
      ) : null}
    </section>
  );
}
