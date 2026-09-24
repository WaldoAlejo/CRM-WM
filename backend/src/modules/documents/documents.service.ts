import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { computeOrderTotal } from "../../lib/paymentRecalculation";
import { conflict, notFound } from "../../utils/httpError";
import type { OperationalDocument } from "./documentPdf";

const variant = { sku: true, label: true, product: { select: { name: true } } } as const;
const location = { code: true, warehouse: { select: { name: true } } } as const;
const customer = {
  wholesaler: { select: { businessName: true, ruc: true } },
  finalCustomer: { select: { fullName: true, idNumber: true } },
} as const;
// Deliberate allowlists: factory/landed costs, margins, private notes and bank
// attachments must never reach client documents, even for an ADMIN download.
const orderSelect = {
  id: true, orderNumber: true, origin: true, status: true, dispatchDate: true, createdAt: true,
  shippingProvince: true, shippingCity: true, paymentMethod: true, creditDays: true, dueDate: true,
  ...customer,
  items: { orderBy: { id: "asc" }, select: { quantity: true, unitPrice: true, variant: { select: variant } } },
  payments: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, amount: true, method: true, paidAt: true, createdAt: true } },
  shipment: { select: { status: true, trackingNumber: true, courier: { select: { name: true } } } },
} as const satisfies Prisma.DispatchOrderSelect;
type Order = Prisma.DispatchOrderGetPayload<{ select: typeof orderSelect }>;
const money = (value: Prisma.Decimal) => `USD ${value.toFixed(2)}`;
const date = (value: Date | null) => value ? value.toLocaleString("es-EC", { timeZone: "America/Guayaquil" }) : "Pendiente";
const product = (v: { sku: string; label: string | null; product: { name: string } }) => [v.sku, v.product.name, v.label].filter(Boolean).join(" · ");
const party = (o: Pick<Order, "wholesaler" | "finalCustomer">) => o.wholesaler
  ? `${o.wholesaler.businessName} | RUC: ${o.wholesaler.ruc}`
  : `${o.finalCustomer?.fullName ?? "Sin cliente registrado"} | Identificación: ${o.finalCustomer?.idNumber ?? "Sin registrar"}`;
const sumPaid = (payments: { amount: Prisma.Decimal }[]) => payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
const balances = (total: Prisma.Decimal, paid: Prisma.Decimal): [string, string][] => [
  ["Total de la orden", money(total)], ["Pagos netos registrados", money(paid)],
  ["Saldo pendiente", money(Prisma.Decimal.max(total.minus(paid), 0))],
  ...(paid.gt(total) ? [["Excedente registrado", money(paid.minus(total))] as [string, string]] : []),
];
const terms = (o: Pick<Order, "paymentMethod" | "creditDays" | "dueDate">): [string, string][] => [
  ["Condición", o.paymentMethod === "CREDITO" ? `Crédito de ${o.creditDays ?? 0} días` : o.paymentMethod === "CONTRA_ENTREGA" ? "Contra entrega" : o.paymentMethod === "CONSIGNACION" ? "Consignación" : "Contado"],
  ...(o.paymentMethod === "CREDITO" ? [["Vencimiento", o.dueDate ? date(o.dueDate) : "Se establece al confirmar el despacho"] as [string, string]] : []),
];
async function getOrder(id: string) {
  const order = await prisma.dispatchOrder.findFirst({ where: { id, deletedAt: null }, select: orderSelect });
  if (!order) throw notFound("Orden no encontrada");
  return order;
}
export function dispatchDocument(o: Order): OperationalDocument {
  const pending = o.status === "PENDIENTE";
  const canceled = o.status === "CANCELADO";
  const title = canceled ? "Orden cancelada" : pending ? "Orden pendiente de despacho"
    : o.origin === "CONSIGNACION_LIQUIDACION" ? "Liquidación de consignación"
    : o.origin === "CONSIGNACION_DEVOLUCION_NO_CONFORME" ? "Cargo por devolución no conforme" : "Comprobante de despacho";
  return {
    title, reference: o.orderNumber,
    fields: [["Cliente", party(o)], ["Estado", o.status], ["Fecha de registro", date(o.createdAt)],
      ["Fecha de despacho / cargo", date(o.dispatchDate)], ["Destino", `${o.shippingCity}, ${o.shippingProvince}`], ...terms(o),
      ...(o.shipment ? [["Envío", `${o.shipment.courier.name} · ${o.shipment.status} · Guía: ${o.shipment.trackingNumber ?? "Sin registrar"}`] as [string, string]] : [])],
    columns: ["Producto", "Unidades", "Precio unitario", "Importe"],
    rows: o.items.map(i => [product(i.variant), String(i.quantity), money(i.unitPrice), money(i.unitPrice.times(i.quantity))]),
    totals: o.paymentMethod === "CONSIGNACION" ? [["Valor referencial en consignación", money(computeOrderTotal(o.items))]] : balances(computeOrderTotal(o.items), sumPaid(o.payments)).map(([label, value]) => [
      label === "Saldo pendiente" && (pending || canceled) ? "Diferencia contable (no exigible por este documento)" : label, value,
    ]),
    notices: [...(o.paymentMethod === "CONSIGNACION" ? ["La entrega en consignación no genera deuda. Solo se cobra lo liquidado posteriormente."] : []), "Precios finales acordados en USD; los descuentos ya están incluidos.",
      ...(pending ? ["Pendiente de confirmación: no acredita salida ni entrega de mercadería."] : []),
      ...(canceled ? ["Orden cancelada: este documento no constituye una solicitud de pago."] : []),
      ...(o.origin !== "NORMAL" ? ["Este cargo corresponde a mercadería entregada previamente en consignación. No representa una nueva salida de bodega."] : []),
      ...(o.shipment && ["RECHAZADO", "PERDIDO", "DANADO"].includes(o.shipment.status)
        ? ["Envío con incidencia: los importes reflejan los registros de la orden; consultar su devolución o resolución antes del cobro."] : []),
    ],
  };
}

export function paymentDocument(o: Order, paymentId: string): OperationalDocument {
  // Registration order, not paidAt: a backdated payment must not rewrite previous receipts.
  const ordered = [...o.payments].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const index = ordered.findIndex(p => p.id === paymentId);
  if (index < 0) throw notFound("Pago no encontrado en esta orden");
  const payment = ordered[index];
  const total = computeOrderTotal(o.items);
  const before = sumPaid(ordered.slice(0, index));
  const after = before.plus(payment.amount);
  const title = payment.amount.lt(0) ? "Comprobante de reembolso / reverso"
    : payment.amount.isZero() ? "Registro de cobro sin importe"
    : after.gte(total) ? "Comprobante de pago total" : "Comprobante de pago parcial";
  return {
    title, reference: payment.id,
    fields: [["Orden", o.orderNumber], ["Cliente", party(o)], ["Fecha del pago", date(payment.paidAt)],
      ["Registrado", date(payment.createdAt)], ["Método", payment.method], ...terms(o)],
    columns: [], rows: [],
    totals: [["Total de la orden", money(total)], ["Pagos netos anteriores", money(before)],
      [payment.amount.lt(0) ? "Importe devuelto / revertido" : "Importe de este pago", money(payment.amount.abs())],
      ["Pagos netos después de este registro", money(after)],
      ["Saldo después de este registro", money(Prisma.Decimal.max(total.minus(after), 0))],
      ...(after.gt(total) ? [["Excedente después de este registro", money(after.minus(total))] as [string, string]] : [])],
    notices: ["Este recibo corresponde exclusivamente al registro indicado y no incluye pagos o reversos registrados después.",
      ...(o.status !== "DESPACHADO" ? [`Estado actual de la orden: ${o.status}. El recibo acredita el registro de dinero, no la entrega de mercadería.`] : [])],
  };
}

const movementSelect = {
  id: true, type: true, quantity: true, createdAt: true, volumeCbm: true, packaging: true,
  variant: { select: variant }, fromLocation: { select: location }, toLocation: { select: location },
  importBatch: { select: { reference: true } },
  dispatchOrderItem: { select: { dispatchOrder: { select: { orderNumber: true } } } },
  consignmentDelivery: { select: { lot: { select: { code: true } } } },
} as const;
type Movement = Prisma.InventoryMovementGetPayload<{ select: typeof movementSelect }>;
const place = (l: Movement["toLocation"]) => l ? `${l.warehouse.name} / ${l.code}` : "Sin ubicación registrada";
function warehouseDocument(reference: string, movements: Movement[], title: string): OperationalDocument {
  if (!movements.length) throw conflict("No hay movimientos de bodega registrados para este documento");
  return {
    title, reference,
    fields: [["Movimientos", String(movements.length)]],
    columns: ["Producto / movimiento", "Unidades", "Ubicación", "Fecha / CBM"],
    rows: movements.map(m => {
      const p = m.packaging && typeof m.packaging === "object" && !Array.isArray(m.packaging) ? m.packaging : null;
      const packing = p ? `\nCartones: ${p.cartonCount ?? "Sin registrar"}; unidades/cartón: ${p.unitsPerCarton ?? "Sin registrar"}\nApilamiento: ${p.maxStackCartons ?? "Sin registrar"} cartones (${p.stackingConfirmed ? "confirmado" : "estimado"})` : "";
      const source = m.importBatch?.reference ?? m.dispatchOrderItem?.dispatchOrder.orderNumber ?? m.consignmentDelivery?.lot.code;
      return [`${product(m.variant)}\n${m.type} · ${m.id}${source ? `\nOrigen: ${source}` : ""}${packing}`, String(Math.abs(m.quantity)),
        place(m.quantity > 0 ? m.toLocation : m.fromLocation), `${date(m.createdAt)}\nCBM: ${m.volumeCbm?.toString() ?? "Sin registrar"}`];
    }),
    totals: [["Unidades documentadas", String(movements.reduce((sum, m) => sum + Math.abs(m.quantity), 0))]],
    notices: ["Respaldo de movimientos efectivamente registrados. Ubicación y empaque reflejan los datos disponibles al generar esta copia."],
  };
}

export async function getDispatchDocument(id: string) { return dispatchDocument(await getOrder(id)); }
export async function getPaymentDocument(id: string, paymentId: string) { return paymentDocument(await getOrder(id), paymentId); }
export async function getDispatchExitDocument(id: string) {
  const order = await getOrder(id);
  const movements = await prisma.inventoryMovement.findMany({ where: { type: { in: ["SALIDA", "CONSIGNACION"] }, dispatchOrderItem: { dispatchOrderId: id } }, select: movementSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const doc = warehouseDocument(order.orderNumber, movements, "Comprobante de salida de bodega");
  doc.fields.push(["Cliente", party(order)], ["Destino", `${order.shippingCity}, ${order.shippingProvince}`]);
  return doc;
}
export async function getImportDocument(id: string) {
  const batch = await prisma.importBatch.findUnique({ where: { id }, select: {
    reference: true, supplier: { select: { name: true } },
    movements: { where: { type: "INGRESO" }, select: movementSelect, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
  } });
  if (!batch) throw notFound("Importación no encontrada");
  const doc = warehouseDocument(batch.reference, batch.movements, "Comprobante de ingresos de bodega");
  doc.fields.push(["Proveedor", batch.supplier?.name ?? "Sin registrar"]);
  doc.notices.push("Consolidado de las recepciones del lote; cada movimiento conserva su fecha e identificador.");
  return doc;
}
export async function getMovementDocument(id: string) {
  const movement = await prisma.inventoryMovement.findUnique({ where: { id }, select: movementSelect });
  if (!movement) throw notFound("Movimiento no encontrado");
  return warehouseDocument(id, [movement], movement.quantity > 0 ? "Comprobante de ingreso de bodega" : "Comprobante de salida de bodega");
}

export async function getConsignmentDocument(id: string, exit = false): Promise<OperationalDocument> {
  const lot = await prisma.consignmentLot.findUnique({ where: { id }, select: {
    code: true, deliveredAt: true, reviewIntervalDays: true, creditDays: true, nextReviewDate: true, status: true,
    shippingCity: true, shippingProvince: true, wholesaler: customer.wholesaler,
    lines: { orderBy: { id: "asc" }, select: { quantityDelivered: true, unitPrice: true, variant: { select: variant }, deliveryMovement: { select: movementSelect } } },
  } });
  if (!lot) throw notFound("Consignación no encontrada");
  const fields: [string, string][] = [["Cliente", party({ wholesaler: lot.wholesaler, finalCustomer: null })],
    ["Entregado", date(lot.deliveredAt)], ["Destino", `${lot.shippingCity}, ${lot.shippingProvince}`]];
  if (exit) {
    const doc = warehouseDocument(lot.code, lot.lines.map(l => l.deliveryMovement), "Salida de bodega por consignación");
    doc.fields.push(...fields); return doc;
  }
  return {
    title: "Entrega en consignación", reference: lot.code,
    fields: [...fields, ["Estado actual", lot.status], ["Revisión acordada", `Cada ${lot.reviewIntervalDays} días`],
      ["Próxima revisión vigente", lot.status === "CERRADO" ? "Lote cerrado" : date(lot.nextReviewDate)],
      ["Crédito de cada cargo", `${lot.creditDays} días desde su liquidación o generación del cargo por no conformidad`]],
    columns: ["Producto", "Entregadas", "Precio acordado", "Valor consignado"],
    rows: lot.lines.map(l => [product(l.variant), String(l.quantityDelivered), money(l.unitPrice), money(l.unitPrice.times(l.quantityDelivered))]),
    totals: [["Valor de la entrega en consignación", money(computeOrderTotal(lot.lines.map(l => ({ unitPrice: l.unitPrice, quantity: l.quantityDelivered }))))]],
    notices: ["La entrega en consignación no genera un cobro inmediato. El valor consignado no es una deuda exigible.",
      "Lo vendido se cobra mediante una liquidación independiente con su fecha de vencimiento. Las devoluciones requieren validación; las no conformes pueden generar un cargo.",
      "Consulte los documentos de liquidación y sus recibos para conocer los cargos y saldos a pagar."],
  };
}

export async function getReviewDocument(id: string): Promise<OperationalDocument> {
  const review = await prisma.consignmentReview.findUnique({ where: { id }, select: {
    id: true, reviewedAt: true, action: true, nextReviewDate: true,
    lot: { select: { code: true, wholesaler: customer.wholesaler } },
    lines: { orderBy: { id: "asc" }, select: { quantitySold: true, quantityReturned: true, line: { select: { variant: { select: variant }, unitPrice: true } } } },
    chargeOrder: { select: orderSelect }, returnBatch: { select: { id: true } },
  } });
  if (!review) throw notFound("Revisión no encontrada");
  return {
    title: review.action === "EXTENDER" ? "Extensión de consignación" : "Revisión y liquidación de consignación",
    reference: review.id,
    fields: [["Consignación", review.lot.code], ["Cliente", party({ wholesaler: review.lot.wholesaler, finalCustomer: null })],
      ["Revisión", date(review.reviewedAt)], ["Siguiente revisión", review.nextReviewDate ? date(review.nextReviewDate) : "Sin revisión pendiente"],
      ...(review.chargeOrder ? [["Cargo generado", review.chargeOrder.orderNumber] as [string, string], ...terms(review.chargeOrder)] : [])],
    columns: ["Producto", "Vendidas", "Devueltas", "Importe vendido"],
    rows: review.lines.map(l => [product(l.line.variant), String(l.quantitySold), String(l.quantityReturned), money(l.line.unitPrice.times(l.quantitySold))]),
    totals: review.chargeOrder ? balances(computeOrderTotal(review.chargeOrder.items), sumPaid(review.chargeOrder.payments)) : [["Cargo generado en esta revisión", "USD 0.00"]],
    notices: ["Las devoluciones se documentan y validan por separado. Los saldos incluyen pagos registrados hasta la generación de esta copia.",
      ...(review.returnBatch ? [`Devolución relacionada: ${review.returnBatch.id}`] : [])],
  };
}

export async function getReturnDocument(id: string, reentry = false): Promise<OperationalDocument> {
  const batch = await prisma.returnBatch.findUnique({ where: { id }, select: {
    id: true, source: true, createdAt: true, completedAt: true,
    review: { select: { lot: { select: { code: true, wholesaler: customer.wholesaler } } } },
    shipment: { select: { dispatchOrder: { select: { orderNumber: true, ...customer } } } },
    chargeOrder: { select: { orderNumber: true, dueDate: true } },
    lines: { orderBy: { id: "asc" }, select: { quantity: true, variant: { select: variant },
      inspections: { select: { quantity: true, result: true, reentryMovement: { select: movementSelect } } } } },
  } });
  if (!batch) throw notFound("Devolución no encontrada");
  const source = batch.review?.lot.code ?? batch.shipment?.dispatchOrder.orderNumber ?? "Sin referencia";
  const buyer = batch.review ? party({ wholesaler: batch.review.lot.wholesaler, finalCustomer: null })
    : batch.shipment ? party(batch.shipment.dispatchOrder) : "Sin cliente registrado";
  if (reentry) {
    const movements = batch.lines.flatMap(l => l.inspections.flatMap(i => i.reentryMovement ? [i.reentryMovement] : []));
    const doc = warehouseDocument(id, movements, "Reingreso de bodega por devolución");
    doc.fields.push(["Origen", source], ["Cliente", buyer]); return doc;
  }
  return {
    title: "Comprobante de devolución", reference: batch.id,
    fields: [["Origen", source], ["Cliente", buyer], ["Recepción", date(batch.createdAt)],
      ["Estado", batch.completedAt ? "Inspección completada" : "Pendiente de validación"],
      ...(batch.completedAt ? [["Validación completada", date(batch.completedAt)] as [string, string]] : [])],
    columns: ["Producto", "Recibidas", "Aceptadas", "No conformes", "Pendientes"],
    rows: batch.lines.map(l => {
      const accepted = l.inspections.filter(i => i.result === "PASA").reduce((sum, i) => sum + i.quantity, 0);
      const rejected = l.inspections.filter(i => i.result === "NO_PASA").reduce((sum, i) => sum + i.quantity, 0);
      return [product(l.variant), String(l.quantity), String(accepted), String(rejected), String(l.quantity - accepted - rejected)];
    }),
    // The quarantine/return document is operational; the separate charge order
    // contains prices and payment terms, as in the existing screens.
    totals: [],
    notices: ["Recibir una devolución no acredita por sí solo un reingreso a stock ni un reembolso. Solo las unidades aceptadas se reincorporan a bodega.",
      ...(batch.chargeOrder ? [`Cargo por no conformes: ${batch.chargeOrder.orderNumber}. Vencimiento: ${date(batch.chargeOrder.dueDate)}.`]
        : ["Este documento no registra un nuevo cobro al cliente. Los reembolsos, si corresponden, se documentan por separado."])],
  };
}

export async function getOrderReturnDocument(id: string, reentry = false) {
  await getOrder(id);
  const batch = await prisma.returnBatch.findFirst({ where: { shipment: { dispatchOrderId: id } }, select: { id: true } });
  if (!batch) throw notFound("Esta orden no tiene una devolución registrada");
  return getReturnDocument(batch.id, reentry);
}
