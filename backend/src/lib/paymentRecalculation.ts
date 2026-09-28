// paymentStatus/amountPaid de una orden NUNCA se editan a mano: se
// recalculan sumando sus Payment cada vez que se registra uno nuevo (mismo
// principio que `stock` con InventoryMovement). Usado por POST
// /dispatch-orders/:id/payments Y por POST /shipments/:id/deliver (el cobro
// contra entrega también crea un Payment).
import { PaymentStatus, Prisma } from "@prisma/client";

const { Decimal } = Prisma;

interface OrderTotalItem {
  unitPrice: Prisma.Decimal;
  quantity: number;
  ivaRate?: Prisma.Decimal | null;
}

// orderTotal = Σ(unitPrice × quantity). NO se vuelve a aplicar discountPct:
// unitPrice ya es "el precio real cobrado, con descuento aplicado" (así
// quedó definido desde que se diseñó DispatchOrderItem) — descontar de nuevo
// acá contaría el descuento dos veces. Compartida entre
// recalculatePaymentStatus, GET /dispatch-orders/:id y GET
// /accounts-receivable: ninguno de los 3 debe reimplementar esta fórmula.
// El IVA se redondea por tarifa sobre la suma de bases, igual que la factura
// electrónica (totals en modules/fiscal/xml.ts), para que la cuenta por cobrar
// coincida con el importeTotal autorizado por el SRI.
export function computeOrderTotal(items: OrderTotalItem[]): Prisma.Decimal {
  const basesByRate = new Map<string, Prisma.Decimal>();
  let subtotal = new Decimal(0);
  for (const item of items) {
    const base = item.unitPrice.times(item.quantity).toDecimalPlaces(2);
    const rate = new Decimal(item.ivaRate ?? 0).toString();
    subtotal = subtotal.plus(base);
    basesByRate.set(rate, (basesByRate.get(rate) ?? new Decimal(0)).plus(base));
  }
  let tax = new Decimal(0);
  for (const [rate, base] of basesByRate) tax = tax.plus(base.times(rate).div(100).toDecimalPlaces(2));
  return subtotal.plus(tax).toDecimalPlaces(2);
}

export async function recalculatePaymentStatus(tx: Prisma.TransactionClient, dispatchOrderId: string) {
  const [order, paymentAgg] = await Promise.all([
    tx.dispatchOrder.findUniqueOrThrow({
      where: { id: dispatchOrderId },
      include: { items: { select: { unitPrice: true, ivaRate: true, quantity: true } } },
    }),
    tx.payment.aggregate({ where: { dispatchOrderId }, _sum: { amount: true } }),
  ]);

  const orderTotal = Prisma.Decimal.max(0, computeOrderTotal(order.items).minus(order.fiscalCreditTotal));

  const amountPaid = (paymentAgg._sum.amount ?? new Decimal(0)).toDecimalPlaces(2);

  // Si amountPaid > orderTotal (pago de más), se acepta igual: Payment es un
  // ledger de lo que realmente entró, no se rechaza un cobro real solo
  // porque el número no cierra exacto. Como no hay un estado tipo "pagado de
  // más", simplemente se tope en PAGADO — el excedente queda visible
  // comparando amountPaid contra la suma de los items en la respuesta.
  let paymentStatus: PaymentStatus;
  if ((orderTotal.greaterThan(0) && amountPaid.greaterThanOrEqualTo(orderTotal)) || (orderTotal.isZero() && order.fiscalCreditTotal.greaterThan(0))) {
    paymentStatus = PaymentStatus.PAGADO;
  } else if (amountPaid.greaterThan(0)) {
    paymentStatus = PaymentStatus.PARCIAL;
  } else {
    paymentStatus = PaymentStatus.PENDIENTE;
  }

  return tx.dispatchOrder.update({
    where: { id: dispatchOrderId },
    data: { amountPaid, paymentStatus },
  });
}
