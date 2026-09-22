// Recordatorios de cobro por correo al mayorista. Cubre cuentas por cobrar
// (órdenes CREDITO despachadas, incluidos los cargos de Consignación) con saldo
// pendiente, en DOS tipos de aviso distintos:
//
//   POR_VENCER — dueDate entre hoy y +7 días ("su pago está por vencer").
//   VENCIDA    — dueDate ya pasó ("su pago está vencido").
//
// El tipo sale de classifyReceivable (lib/receivableStatus.ts): exactamente el
// mismo clasificador y umbral que el semáforo del listado/detalle/Dashboard,
// así el color que ve el equipo y el correo que recibe el mayorista nunca se
// contradicen.
//
// POLÍTICA DE ENVÍO (fácil de cambiar): por defecto UN solo aviso de cada tipo
// por cuenta, para no spamear. Con REMINDER_REPEAT_DAILY=true cada tipo se
// reenvía cada día mientras la cuenta siga en ese estado.
//
// UNA sola marca, sin columna nueva: DispatchOrder.remindedAt guarda cuándo se
// envió el ÚLTIMO aviso, y de esa fecha se deduce de qué tipo fue:
//   remindedAt <= dueDate  → fue un aviso POR_VENCER (solo se envían con dueDate >= ahora)
//   remindedAt  > dueDate  → fue un aviso VENCIDA    (solo se envían con dueDate <  ahora)
// Por eso una cuenta que recibió "por vencer" y luego vence de verdad NO se
// considera ya avisada: recibe "vencida" como un evento nuevo.
import { DispatchStatus, PaymentMethod, PaymentStatus, Prisma } from "@prisma/client";
import { getMailer, type Mailer } from "../lib/mailer";
import { computeOrderTotal } from "../lib/paymentRecalculation";
import { prisma } from "../lib/prisma";
import { classifyReceivable, dueSoonUpperBound } from "../lib/receivableStatus";

const DAY_MS = 24 * 60 * 60 * 1000;
// "Cada día" con margen: si el job corrió ayer 08:00 y hoy 07:59, igual cuenta.
const DAILY_MIN_GAP_MS = 20 * 60 * 60 * 1000;

export type ReminderKind = "POR_VENCER" | "VENCIDA";

export interface ReminderOptions {
  now?: Date;
  repeatDaily?: boolean;
  // Tope de atraso para el aviso de VENCIDA (REMINDER_OVERDUE_MAX_DAYS): las
  // cuentas con MÁS días completos de atraso que esto no reciben aviso. Sin valor =
  // sin tope. No aplica al aviso "por vencer".
  overdueMaxDays?: number;
  // Inyectable para tests; por defecto el mailer SMTP real (o null si no hay SMTP).
  mailer?: Mailer | null;
}

export interface ReminderSummary {
  candidates: number;
  sent: number;
  sentDueSoon: number;
  sentOverdue: number;
  skippedNoEmail: number;
  // Vencidas omitidas por superar overdueMaxDays (no se marcan: si se sube el tope, se avisan).
  skippedTooOld: number;
  failed: number;
  mailConfigured: boolean;
}

// Lee REMINDER_OVERDUE_MAX_DAYS. Vacío/ausente = sin tope. Un valor inválido LANZA
// error a propósito: es una protección, y una errata no debe dejar el job corriendo
// sin ella (el scheduler no se programa; el CLI aborta).
export function parseOverdueMaxDays(env: NodeJS.ProcessEnv = process.env): number | undefined {
  const raw = env.REMINDER_OVERDUE_MAX_DAYS?.trim();
  if (!raw) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`REMINDER_OVERDUE_MAX_DAYS inválido ("${raw}"): debe ser un entero de 0 en adelante, o estar vacío para no poner tope.`);
  }
  return value;
}

const money = (d: Prisma.Decimal) => `$${d.toFixed(2)}`;
const fmtDate = (d: Date) =>
  d.toLocaleDateString("es-EC", { day: "2-digit", month: "long", year: "numeric", timeZone: "America/Guayaquil" });

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

interface MessageInput {
  kind: ReminderKind;
  businessName: string;
  orderNumber: string;
  dueDate: Date;
  balance: Prisma.Decimal;
  now: Date;
  origin: string;
}

function buildMessage(input: MessageInput) {
  const originNote = input.origin === "NORMAL" ? "" : " (corresponde a una liquidación de consignación)";
  const due = fmtDate(input.dueDate);

  let subject: string;
  let statement: string;
  if (input.kind === "POR_VENCER") {
    const daysLeft = Math.ceil((input.dueDate.getTime() - input.now.getTime()) / DAY_MS);
    const when = daysLeft <= 0 ? "vence hoy" : daysLeft === 1 ? "vence mañana" : `vence en ${daysLeft} días`;
    subject = `Recordatorio: pago por vencer — orden ${input.orderNumber}`;
    statement = `Le recordamos que el pago de la orden ${input.orderNumber}${originNote} ${when}, el ${due}.`;
  } else {
    const daysLate = Math.floor((input.now.getTime() - input.dueDate.getTime()) / DAY_MS);
    const ago = daysLate <= 0 ? "" : daysLate === 1 ? ", hace 1 día" : `, hace ${daysLate} días`;
    subject = `Aviso: pago vencido — orden ${input.orderNumber}`;
    statement = `Le informamos que su pago está vencido: la orden ${input.orderNumber}${originNote} venció el ${due}${ago}.`;
  }

  const closing =
    input.kind === "POR_VENCER"
      ? "Si ya realizó el pago, por favor ignore este mensaje o envíenos el comprobante."
      : "Le pedimos regularizarlo a la brevedad. Si ya realizó el pago, envíenos el comprobante para actualizar su cuenta.";

  const text = [
    `Estimado/a ${input.businessName}:`,
    "",
    statement,
    `Saldo pendiente: ${money(input.balance)}.`,
    "",
    closing,
    "",
    "Gracias por su preferencia.",
  ].join("\n");
  const html = `<p>Estimado/a <strong>${escapeHtml(input.businessName)}</strong>:</p>
<p>${escapeHtml(statement)}</p>
<p>Saldo pendiente: <strong>${money(input.balance)}</strong>.</p>
<p>${escapeHtml(closing)}</p>
<p>Gracias por su preferencia.</p>`;
  return { subject, text, html };
}

// ¿Esta cuenta debe recibir el aviso de este tipo ahora? Ver el bloque de
// comentarios del inicio: el tipo del último aviso se deduce de remindedAt vs. dueDate.
function isEligible(kind: ReminderKind, remindedAt: Date | null, dueDate: Date, now: Date, repeatDaily: boolean) {
  if (remindedAt === null) return true;
  const lastNoticeWasOverdue = remindedAt.getTime() > dueDate.getTime();

  // Un aviso del OTRO tipo no cuenta como ya notificado: un "por vencer" previo
  // no impide el "vencida" (evento nuevo).
  const lastNoticeIsSameKind = kind === "VENCIDA" ? lastNoticeWasOverdue : !lastNoticeWasOverdue;
  if (!lastNoticeIsSameKind) return true;

  return repeatDaily && remindedAt.getTime() < now.getTime() - DAILY_MIN_GAP_MS;
}

export async function runDueReminders(options: ReminderOptions = {}): Promise<ReminderSummary> {
  const now = options.now ?? new Date();
  const repeatDaily = options.repeatDaily ?? false;
  const mailer = options.mailer === undefined ? getMailer() : options.mailer;

  const summary: ReminderSummary = {
    candidates: 0,
    sent: 0,
    sentDueSoon: 0,
    sentOverdue: 0,
    skippedNoEmail: 0,
    skippedTooOld: 0,
    failed: 0,
    mailConfigured: mailer !== null,
  };
  // Sin SMTP no se envía NI se marca nada: cuando se configure, se recupera todo.
  if (!mailer) return summary;

  // Todo lo que está por vencer O ya vencido, con saldo pendiente. El tipo y la
  // elegibilidad se resuelven abajo con el clasificador compartido.
  const orders = await prisma.dispatchOrder.findMany({
    where: {
      deletedAt: null,
      status: DispatchStatus.DESPACHADO,
      paymentMethod: PaymentMethod.CREDITO,
      paymentStatus: { not: PaymentStatus.PAGADO },
      wholesalerId: { not: null },
      dueDate: { not: null, lte: dueSoonUpperBound(now) },
    },
    orderBy: { dueDate: "asc" },
    include: {
      wholesaler: { select: { businessName: true, email: true } },
      items: { select: { unitPrice: true, quantity: true } },
    },
  });

  for (const order of orders) {
    const state = classifyReceivable(order, now);
    const kind: ReminderKind | null = state === "POR_VENCER" ? "POR_VENCER" : state === "VENCIDO" ? "VENCIDA" : null;
    if (!kind) continue;
    if (!isEligible(kind, order.remindedAt, order.dueDate!, now, repeatDaily)) continue;

    // Tope de antigüedad SOLO para "vencida" (las deudas muy viejas suelen gestionarse
    // por otro medio). Días completos de atraso, los mismos que dice el correo: con
    // tope 30, una cuenta con 30 días y unas horas de atraso aún se avisa; con 31 no.
    if (kind === "VENCIDA" && options.overdueMaxDays !== undefined) {
      const daysLate = Math.floor((now.getTime() - order.dueDate!.getTime()) / DAY_MS);
      if (daysLate > options.overdueMaxDays) {
        summary.skippedTooOld++;
        continue;
      }
    }

    const balance = computeOrderTotal(order.items).minus(order.amountPaid ?? new Prisma.Decimal(0));
    if (balance.lessThanOrEqualTo(0)) continue; // sin saldo real: nada que recordar.
    summary.candidates++;

    const email = order.wholesaler?.email?.trim();
    if (!email) {
      // Sin correo no se marca: cuando se cargue el correo, se avisará.
      summary.skippedNoEmail++;
      console.warn(`[recordatorios] ${order.orderNumber}: el mayorista no tiene correo registrado.`);
      continue;
    }

    // Reclamo atómico ANTES de enviar: si dos corridas se solapan, solo una
    // gana la fila (count = 1) y el mayorista no recibe el correo duplicado.
    const previous = order.remindedAt;
    const claimed = await prisma.dispatchOrder.updateMany({
      where: { id: order.id, remindedAt: previous },
      data: { remindedAt: now },
    });
    if (claimed.count === 0) continue;

    try {
      await mailer.send({
        to: email,
        ...buildMessage({
          kind,
          businessName: order.wholesaler!.businessName,
          orderNumber: order.orderNumber,
          dueDate: order.dueDate!,
          balance,
          now,
          origin: order.origin,
        }),
      });
      summary.sent++;
      if (kind === "POR_VENCER") summary.sentDueSoon++;
      else summary.sentOverdue++;
    } catch (err) {
      // El envío falló: se devuelve la marca para reintentar en la próxima corrida.
      await prisma.dispatchOrder.updateMany({ where: { id: order.id, remindedAt: now }, data: { remindedAt: previous } });
      summary.failed++;
      console.error(`[recordatorios] ${order.orderNumber}: no se pudo enviar a ${email}:`, (err as Error).message);
    }
  }

  return summary;
}
