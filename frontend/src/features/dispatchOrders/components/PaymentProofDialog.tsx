import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { apiFetchBlob } from "@/lib/api";

interface PaymentProofDialogProps {
  orderId: string;
  paymentId: string | null; // null = cerrado
  onClose: () => void;
}

// El comprobante NO tiene URL pública: se pide por un endpoint autenticado
// (solo ADMIN/CEO), así que un <img src> directo no sirve (no llevaría el
// token). Se baja como Blob y se muestra desde un object URL que se libera al cerrar.
export function PaymentProofDialog({ orderId, paymentId, onClose }: PaymentProofDialogProps) {
  const { data: blob, isLoading, isError } = useQuery({
    queryKey: ["dispatchOrders", "payment-proof", orderId, paymentId],
    queryFn: () => apiFetchBlob(`/dispatch-orders/${orderId}/payments/${paymentId}/proof`),
    enabled: paymentId !== null,
    // Un comprobante nunca cambia (ledger append-only): no hace falta refrescarlo.
    staleTime: Infinity,
    gcTime: 0,
  });

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    setObjectUrl(url);
    return () => {
      URL.revokeObjectURL(url);
      setObjectUrl(null);
    };
  }, [blob]);

  return (
    <Dialog open={paymentId !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Comprobante de pago</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <Skeleton className="h-64 w-full" />
        ) : isError ? (
          <p className="text-sm text-destructive">No se pudo cargar el comprobante.</p>
        ) : objectUrl ? (
          <img src={objectUrl} alt="Comprobante de pago" className="max-h-[70vh] w-full rounded-md border object-contain" />
        ) : null}
        <p className="text-xs text-muted-foreground">
          Solo lectura: un comprobante registrado no se puede editar ni eliminar.
        </p>
      </DialogContent>
    </Dialog>
  );
}
