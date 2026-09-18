import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCanManagePayments } from "../useCanManagePayments";
import type { Payment } from "../dispatchOrders.types";
import { RegisterPaymentDialog } from "./RegisterPaymentDialog";

interface PaymentsSectionProps {
  orderId: string;
  payments: Payment[];
  amountPaid: string | null;
  orderTotal: string;
}

// La LISTA de pagos es visible para cualquier rol (GET /dispatch-orders/:id
// no la filtra ni la omite) — lo que sí es ADMIN-only, según
// requireRole(Role.ADMIN) en POST /:id/payments, es la capacidad de
// REGISTRAR uno nuevo. Por eso solo el botón está gateado, no la sección
// entera (a diferencia de los campos de costo, que el backend sí omite del
// JSON para OPERATOR).
export function PaymentsSection({ orderId, payments, amountPaid, orderTotal }: PaymentsSectionProps) {
  const canManage = useCanManagePayments();
  const [registerOpen, setRegisterOpen] = useState(false);

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Pagos</h2>
        {canManage ? <Button size="sm" onClick={() => setRegisterOpen(true)}>Registrar pago</Button> : null}
      </div>

      {payments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no se registró ningún pago.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Monto</TableHead>
              <TableHead>Método</TableHead>
              <TableHead>Fecha</TableHead>
              <TableHead>Notas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {payments.map((payment) => (
              <TableRow key={payment.id}>
                <TableCell>${payment.amount}</TableCell>
                <TableCell>{payment.method}</TableCell>
                <TableCell>{new Date(payment.paidAt).toLocaleDateString("es-EC")}</TableCell>
                <TableCell>{payment.notes ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <p className="text-right text-sm font-medium">
        Pagado: ${amountPaid ?? "0.00"} / ${orderTotal}
      </p>

      {canManage ? (
        <RegisterPaymentDialog open={registerOpen} onOpenChange={setRegisterOpen} orderId={orderId} />
      ) : null}
    </section>
  );
}
