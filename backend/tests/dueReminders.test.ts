import { randomUUID } from "crypto";
import cron from "node-cron";
import { afterEach, describe, expect, vi } from "vitest";
import { parseOverdueMaxDays, runDueReminders } from "../src/jobs/dueReminders";
import { classifyReceivable } from "../src/lib/receivableStatus";
import { startScheduler } from "../src/jobs/scheduler";
import type { MailMessage, Mailer } from "../src/lib/mailer";
import {
  createCategoryFixture,
  createProductFixture,
  createVariantFixture,
  prisma,
  resetDatabase,
} from "./helpers";
import { it, settleInflight } from "./inflight";

vi.setConfig({ testTimeout: 60000 });

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-22T13:00:00.000Z");

afterEach(async () => {
  await settleInflight(); // nunca truncar mientras el cuerpo de un test sigue corriendo
  await resetDatabase();
});

// Mailer falso: nunca se envía un correo real en tests.
function fakeMailer(opts: { failFor?: Set<string> } = {}) {
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    async send(message) {
      if (opts.failFor?.has(message.to)) throw new Error("SMTP caído");
      sent.push(message);
    },
  };
  return { mailer, sent };
}

let orderCounter = 0;
async function makeWholesaler(email: string | null = "cobranzas@mayorista.test") {
  return prisma.wholesaler.create({
    data: {
      businessName: `Mayorista ${randomUUID().slice(0, 6)}`,
      ruc: Array.from({ length: 13 }, () => Math.floor(Math.random() * 10)).join(""),
      email,
    },
  });
}

// Orden CREDITO ya despachada, creada directo en BD (total = qty × price).
async function makeCreditOrder(opts: {
  wholesalerId: string;
  dueInDays?: number | null;
  // Offset exacto en ms (para bordes); si viene, manda sobre dueInDays.
  dueOffsetMs?: number;
  total?: number;
  amountPaid?: number;
  paymentStatus?: "PENDIENTE" | "PARCIAL" | "PAGADO";
  paymentMethod?: "CREDITO" | "CONTADO";
  status?: "PENDIENTE" | "DESPACHADO";
  origin?: "NORMAL" | "CONSIGNACION_LIQUIDACION";
  remindedAt?: Date | null;
}) {
  const { category } = await createCategoryFixture();
  const product = await createProductFixture({ categoryId: category.id });
  const variant = await createVariantFixture({ productId: product.id, stock: 100 });
  const total = opts.total ?? 100;
  return prisma.dispatchOrder.create({
    data: {
      orderNumber: `OD-T${++orderCounter}${randomUUID().slice(0, 4)}`,
      buyerType: "MAYORISTA",
      wholesalerId: opts.wholesalerId,
      shippingProvince: "Guayas",
      shippingCity: "Guayaquil",
      status: opts.status ?? "DESPACHADO",
      dispatchDate: NOW,
      paymentMethod: opts.paymentMethod ?? "CREDITO",
      creditDays: 30,
      dueDate:
        opts.dueOffsetMs !== undefined
          ? new Date(NOW.getTime() + opts.dueOffsetMs)
          : opts.dueInDays === null || opts.dueInDays === undefined
            ? null
            : new Date(NOW.getTime() + opts.dueInDays * DAY_MS),
      paymentStatus: opts.paymentStatus ?? (opts.amountPaid ? "PARCIAL" : "PENDIENTE"),
      amountPaid: opts.amountPaid,
      origin: opts.origin ?? "NORMAL",
      remindedAt: opts.remindedAt,
      items: { create: [{ variantId: variant.id, quantity: 1, priceType: "MAYORISTA", unitPrice: total }] },
    },
  });
}

const remindedAt = async (id: string) => (await prisma.dispatchOrder.findUniqueOrThrow({ where: { id } })).remindedAt;

describe("Recordatorio de pago por vencer — a quién y cuándo", () => {
  it("escribe al mayorista con orden, fecha de vencimiento y saldo, y deja registrado el envío", async () => {
    const w = await makeWholesaler();
    const order = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 5, total: 100 });
    const { mailer, sent } = fakeMailer();

    const summary = await runDueReminders({ now: NOW, mailer });

    expect(summary).toMatchObject({ candidates: 1, sent: 1, failed: 0, skippedNoEmail: 0, mailConfigured: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("cobranzas@mayorista.test");
    expect(sent[0].subject).toContain(order.orderNumber);
    expect(sent[0].text).toContain(w.businessName);
    expect(sent[0].text).toContain("vence en 5 días");
    expect(sent[0].text).toContain("$100.00");
    expect(sent[0].html).toContain(order.orderNumber);
    expect((await remindedAt(order.id))?.toISOString()).toBe(NOW.toISOString());
  });

  it("ventana de 7 días: entran hoy..7 días (por vencer); quedan fuera 8 días y sin fecha (las ya vencidas tienen su propio aviso, ver más abajo)", async () => {
    const w = await makeWholesaler();
    const inWindow = [
      await makeCreditOrder({ wholesalerId: w.id, dueInDays: 7 }), // exactamente 7 días
      await makeCreditOrder({ wholesalerId: w.id, dueInDays: 1 }),
      await makeCreditOrder({ wholesalerId: w.id, dueInDays: 0.1 }), // vence hoy
    ];
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: 8 });
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: null });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer });

    expect(sent.map((m) => m.subject).sort()).toEqual(inWindow.map((o) => `Recordatorio: pago por vencer — orden ${o.orderNumber}`).sort());
  });

  it("solo cuentas con saldo: las PAGADAS no reciben correo; una PARCIAL recibe el SALDO real, no el total", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: 3, total: 100, amountPaid: 100, paymentStatus: "PAGADO" });
    const partial = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 3, total: 100, amountPaid: 40, paymentStatus: "PARCIAL" });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer });

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain(partial.orderNumber);
    expect(sent[0].text).toContain("$60.00");
    expect(sent[0].text).not.toContain("$100.00");
  });

  it("solo crédito despachado: ni CONTADO ni órdenes aún PENDIENTES; sí los cargos de Consignación (con su nota)", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: 3, paymentMethod: "CONTADO" });
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: 3, status: "PENDIENTE" });
    const consignment = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 3, origin: "CONSIGNACION_LIQUIDACION" });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer });

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain(consignment.orderNumber);
    expect(sent[0].text).toContain("consignación");
  });
});

describe("Recordatorio de pago por vencer — política de envío", () => {
  it("POR DEFECTO: envío ÚNICO por cuenta — una segunda corrida (incluso al día siguiente) no reenvía", async () => {
    const w = await makeWholesaler();
    const order = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 5 });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer });
    await runDueReminders({ now: NOW, mailer });
    await runDueReminders({ now: new Date(NOW.getTime() + DAY_MS), mailer });

    expect(sent).toHaveLength(1);
    expect((await remindedAt(order.id))?.toISOString()).toBe(NOW.toISOString());
  });

  it("modo diario (REMINDER_REPEAT_DAILY): reenvía cada día dentro de la ventana, pero no dos veces el mismo día", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: 5 });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer, repeatDaily: true });
    await runDueReminders({ now: new Date(NOW.getTime() + 2 * 60 * 60 * 1000), mailer, repeatDaily: true }); // mismo día
    expect(sent).toHaveLength(1);

    await runDueReminders({ now: new Date(NOW.getTime() + DAY_MS), mailer, repeatDaily: true }); // día siguiente
    expect(sent).toHaveLength(2);
    expect(sent[1].text).toContain("vence en 4 días");
  });

  it("dos corridas simultáneas (solapadas) envían UN solo correo: la marca se reclama de forma atómica", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: 5 });
    const { mailer, sent } = fakeMailer();

    await Promise.all([runDueReminders({ now: NOW, mailer }), runDueReminders({ now: NOW, mailer })]);

    expect(sent).toHaveLength(1);
  });
});

describe("Recordatorio de pago por vencer — casos de fallo", () => {
  it("mayorista SIN correo: se omite y NO se marca — cuando se cargue el correo, se recuerda", async () => {
    const w = await makeWholesaler(null);
    const order = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 5 });
    const { mailer, sent } = fakeMailer();

    const first = await runDueReminders({ now: NOW, mailer });
    expect(first).toMatchObject({ candidates: 1, sent: 0, skippedNoEmail: 1 });
    expect(await remindedAt(order.id)).toBeNull();

    await prisma.wholesaler.update({ where: { id: w.id }, data: { email: "nuevo@mayorista.test" } });
    await runDueReminders({ now: NOW, mailer });
    expect(sent.map((m) => m.to)).toEqual(["nuevo@mayorista.test"]);
    expect(await remindedAt(order.id)).not.toBeNull();
  });

  it("si el SMTP falla, la cuenta NO queda marcada como recordada y se reintenta en la siguiente corrida", async () => {
    const w = await makeWholesaler("falla@mayorista.test");
    const order = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 5 });

    const broken = fakeMailer({ failFor: new Set(["falla@mayorista.test"]) });
    const first = await runDueReminders({ now: NOW, mailer: broken.mailer });
    expect(first).toMatchObject({ sent: 0, failed: 1 });
    expect(await remindedAt(order.id)).toBeNull();

    const working = fakeMailer();
    await runDueReminders({ now: NOW, mailer: working.mailer });
    expect(working.sent).toHaveLength(1);
  });

  it("un fallo con un mayorista no impide avisar a los demás", async () => {
    const bad = await makeWholesaler("falla@mayorista.test");
    const good = await makeWholesaler("ok@mayorista.test");
    await makeCreditOrder({ wholesalerId: bad.id, dueInDays: 2 });
    await makeCreditOrder({ wholesalerId: good.id, dueInDays: 3 });
    const { mailer, sent } = fakeMailer({ failFor: new Set(["falla@mayorista.test"]) });

    const summary = await runDueReminders({ now: NOW, mailer });

    expect(summary).toMatchObject({ candidates: 2, sent: 1, failed: 1 });
    expect(sent.map((m) => m.to)).toEqual(["ok@mayorista.test"]);
  });

  it("sin SMTP configurado no envía NI marca nada (al configurarlo se recupera todo)", async () => {
    const w = await makeWholesaler();
    const order = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 5 });

    const summary = await runDueReminders({ now: NOW, mailer: null });

    expect(summary).toMatchObject({ mailConfigured: false, sent: 0, candidates: 0 });
    expect(await remindedAt(order.id)).toBeNull();
  });
});

describe("Aviso de cuentas VENCIDAS (extensión del recordatorio)", () => {
  it("una cuenta que ya venció recibe el correo de VENCIDA: 'su pago está vencido', con saldo y sin el texto de 'por vencer'", async () => {
    const w = await makeWholesaler();
    const order = await makeCreditOrder({ wholesalerId: w.id, dueInDays: -3, total: 100 });
    const { mailer, sent } = fakeMailer();

    const summary = await runDueReminders({ now: NOW, mailer });

    expect(summary).toMatchObject({ candidates: 1, sent: 1, sentOverdue: 1, sentDueSoon: 0 });
    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toBe(`Aviso: pago vencido — orden ${order.orderNumber}`);
    expect(sent[0].text).toContain("su pago está vencido");
    expect(sent[0].text).toContain("hace 3 días");
    expect(sent[0].text).toContain("$100.00");
    expect(sent[0].text).not.toMatch(/por vencer|vence en|vence hoy|vence mañana/);
    expect(sent[0].html).toContain("su pago está vencido");
    expect((await remindedAt(order.id))?.toISOString()).toBe(NOW.toISOString());
  });

  it("el mensaje de 'por vencer' sigue diciendo 'por vencer' (los dos tipos se distinguen para el mayorista)", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: 2 });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer });

    expect(sent[0].subject).toContain("por vencer");
    expect(sent[0].text).not.toContain("está vencido");
  });

  it("cuenta que cruza a vencida genera el correo de vencida: el mismo día que vence NO es vencida, un instante después SÍ", async () => {
    const w = await makeWholesaler();
    const order = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: 0 }); // vence exactamente ahora
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer });
    expect(sent.map((m) => m.subject)).toEqual([`Recordatorio: pago por vencer — orden ${order.orderNumber}`]);

    await runDueReminders({ now: new Date(NOW.getTime() + 1), mailer }); // 1 ms después: ya venció
    expect(sent.map((m) => m.subject)).toEqual([
      `Recordatorio: pago por vencer — orden ${order.orderNumber}`,
      `Aviso: pago vencido — orden ${order.orderNumber}`,
    ]);
  });

  it("una cuenta que ya recibió 'por vencer' y luego vence TAMBIÉN recibe 'vencida' (evento nuevo); y no se repite por defecto", async () => {
    const w = await makeWholesaler();
    const order = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 2 });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer }); // aviso por vencer
    const afterFirst = await remindedAt(order.id);
    expect(afterFirst!.getTime()).toBeLessThanOrEqual(order.dueDate!.getTime()); // marca de "por vencer"

    const later = new Date(NOW.getTime() + 3 * DAY_MS); // ya pasó el vencimiento
    const second = await runDueReminders({ now: later, mailer });
    expect(second).toMatchObject({ sentOverdue: 1, sentDueSoon: 0 });
    expect(sent).toHaveLength(2);
    expect(sent[1].subject).toContain("pago vencido");
    expect((await remindedAt(order.id))!.getTime()).toBeGreaterThan(order.dueDate!.getTime()); // marca de "vencida"

    // Envío único por defecto: ni ese mismo día ni al siguiente se repite.
    await runDueReminders({ now: later, mailer });
    await runDueReminders({ now: new Date(later.getTime() + DAY_MS), mailer });
    expect(sent).toHaveLength(2);
  });

  it("modo diario (REMINDER_REPEAT_DAILY): la vencida se reenvía cada día, no dos veces el mismo día; y 'por vencer' → 'vencida' sigue funcionando", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: 1 });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer, repeatDaily: true }); // por vencer (vence en 1 día)
    const day2 = new Date(NOW.getTime() + 2 * DAY_MS); // ya vencida
    await runDueReminders({ now: day2, mailer, repeatDaily: true }); // vencida (evento nuevo)
    await runDueReminders({ now: new Date(day2.getTime() + 2 * 60 * 60 * 1000), mailer, repeatDaily: true }); // mismo día: no
    expect(sent.map((m) => (m.subject.includes("vencido") ? "V" : "P"))).toEqual(["P", "V"]);

    await runDueReminders({ now: new Date(day2.getTime() + DAY_MS), mailer, repeatDaily: true }); // día siguiente: sí
    expect(sent.map((m) => (m.subject.includes("vencido") ? "V" : "P"))).toEqual(["P", "V", "V"]);
    expect(sent[2].text).toContain("hace 2 días");
  });

  it("cuenta PAGADA no genera nada en ningún caso: ni por vencer ni vencida, ni en modo diario", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: 3, total: 100, amountPaid: 100, paymentStatus: "PAGADO" });
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: -10, total: 100, amountPaid: 100, paymentStatus: "PAGADO" });
    await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: 0, total: 100, amountPaid: 100, paymentStatus: "PAGADO" });
    const { mailer, sent } = fakeMailer();

    for (const repeatDaily of [false, true]) {
      for (const offset of [0, 1, 5, 40]) {
        await runDueReminders({ now: new Date(NOW.getTime() + offset * DAY_MS), mailer, repeatDaily });
      }
    }
    expect(sent).toHaveLength(0);
  });

  it("vencida con abono parcial: recibe el aviso de vencida por el SALDO real, no por el total", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: -2, total: 100, amountPaid: 40, paymentStatus: "PARCIAL" });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer });

    expect(sent).toHaveLength(1);
    expect(sent[0].subject).toContain("pago vencido");
    expect(sent[0].text).toContain("$60.00");
    expect(sent[0].text).not.toContain("$100.00");
  });

  it("cargo de Consignación ya vencido también recibe el aviso de vencida (con su nota)", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: -1, origin: "CONSIGNACION_LIQUIDACION" });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer });

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain("su pago está vencido");
    expect(sent[0].text).toContain("consignación");
  });

  it("vencida sin correo del mayorista: se omite sin marcar, y al cargar el correo recibe el aviso de vencida", async () => {
    const w = await makeWholesaler(null);
    const order = await makeCreditOrder({ wholesalerId: w.id, dueInDays: -2 });
    const { mailer, sent } = fakeMailer();

    expect(await runDueReminders({ now: NOW, mailer })).toMatchObject({ skippedNoEmail: 1, sent: 0 });
    expect(await remindedAt(order.id)).toBeNull();

    await prisma.wholesaler.update({ where: { id: w.id }, data: { email: "nuevo@mayorista.test" } });
    await runDueReminders({ now: NOW, mailer });
    expect(sent.map((m) => m.to)).toEqual(["nuevo@mayorista.test"]);
    expect(sent[0].subject).toContain("pago vencido");
  });

  it("si el SMTP falla al avisar la vencida, se restaura la marca ANTERIOR (la de 'por vencer') y se reintenta sin perder el aviso", async () => {
    const w = await makeWholesaler("falla@mayorista.test");
    const order = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 2 });
    const ok = fakeMailer();
    await runDueReminders({ now: NOW, mailer: ok.mailer }); // por vencer enviado
    const soonMark = await remindedAt(order.id);

    const later = new Date(NOW.getTime() + 3 * DAY_MS);
    const broken = fakeMailer({ failFor: new Set(["falla@mayorista.test"]) });
    expect(await runDueReminders({ now: later, mailer: broken.mailer })).toMatchObject({ failed: 1, sent: 0 });
    expect((await remindedAt(order.id))?.toISOString()).toBe(soonMark!.toISOString()); // volvió a la marca previa

    const retry = fakeMailer();
    await runDueReminders({ now: later, mailer: retry.mailer });
    expect(retry.sent).toHaveLength(1);
    expect(retry.sent[0].subject).toContain("pago vencido");
  });

  it("dos corridas simultáneas sobre una cuenta vencida envían UN solo correo", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueInDays: -2 });
    const { mailer, sent } = fakeMailer();

    await Promise.all([runDueReminders({ now: NOW, mailer }), runDueReminders({ now: NOW, mailer })]);

    expect(sent).toHaveLength(1);
  });
});

describe("Tope de antigüedad del aviso de vencida (REMINDER_OVERDUE_MAX_DAYS)", () => {
  const overdueMailsFor = (sent: MailMessage[], orderNumber: string) =>
    sent.filter((m) => m.subject.includes(orderNumber) && m.subject.includes("pago vencido"));

  it("excluye del aviso de vencida las cuentas cuyo atraso SUPERA el tope; en el borde (días completos) todavía se avisa", async () => {
    const w = await makeWholesaler();
    const at30 = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: -30 * DAY_MS }); // exactamente 30 días
    const at30Hours = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: -(30 * DAY_MS + 5 * 60 * 60 * 1000) }); // 30 días y 5 h
    const at31 = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: -31 * DAY_MS }); // 31 días
    const at90 = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: -90 * DAY_MS });
    const recent = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: -2 * DAY_MS });
    const { mailer, sent } = fakeMailer();

    const summary = await runDueReminders({ now: NOW, mailer, overdueMaxDays: 30 });

    expect(summary).toMatchObject({ sentOverdue: 3, skippedTooOld: 2, failed: 0 });
    expect(overdueMailsFor(sent, at30.orderNumber)).toHaveLength(1);
    expect(overdueMailsFor(sent, at30Hours.orderNumber)).toHaveLength(1);
    expect(overdueMailsFor(sent, recent.orderNumber)).toHaveLength(1);
    expect(overdueMailsFor(sent, at31.orderNumber)).toHaveLength(0);
    expect(overdueMailsFor(sent, at90.orderNumber)).toHaveLength(0);
  });

  it("las excluidas NO se marcan: si el tope se sube después, sí se avisan; sin tope (por defecto) se avisa a todas", async () => {
    const w = await makeWholesaler();
    const old = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: -400 * DAY_MS });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer, overdueMaxDays: 60 });
    expect(sent).toHaveLength(0);
    expect(await remindedAt(old.id)).toBeNull();

    await runDueReminders({ now: NOW, mailer, overdueMaxDays: 500 }); // se sube el tope
    expect(sent).toHaveLength(1);

    // Sin overdueMaxDays no hay tope: una deuda de 400 días también se avisa.
    const old2 = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: -400 * DAY_MS });
    await runDueReminders({ now: NOW, mailer });
    expect(overdueMailsFor(sent, old2.orderNumber)).toHaveLength(1);
  });

  it("NO aplica al aviso de 'por vencer': con el tope más estricto (0) las cuentas por vencer se siguen avisando", async () => {
    const w = await makeWholesaler();
    const soon = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 3 });
    const edge = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: 7 * DAY_MS });
    const { mailer, sent } = fakeMailer();

    const summary = await runDueReminders({ now: NOW, mailer, overdueMaxDays: 0 });

    expect(summary).toMatchObject({ sentDueSoon: 2, sentOverdue: 0, skippedTooOld: 0 });
    expect(sent.map((m) => m.subject).sort()).toEqual(
      [soon, edge].map((o) => `Recordatorio: pago por vencer — orden ${o.orderNumber}`).sort()
    );
  });

  it("tope 0: solo se avisa la que lleva menos de un día completo de atraso", async () => {
    const w = await makeWholesaler();
    const hours = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: -12 * 60 * 60 * 1000 });
    const oneDay = await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: -DAY_MS });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer, overdueMaxDays: 0 });

    expect(overdueMailsFor(sent, hours.orderNumber)).toHaveLength(1);
    expect(overdueMailsFor(sent, oneDay.orderNumber)).toHaveLength(0);
  });

  it("una cuenta avisada 'por vencer' que luego vence MÁS allá del tope no recibe el aviso de vencida (y conserva su marca)", async () => {
    const w = await makeWholesaler();
    const order = await makeCreditOrder({ wholesalerId: w.id, dueInDays: 2 });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer, overdueMaxDays: 30 }); // por vencer: se avisa
    const mark = await remindedAt(order.id);

    const muchLater = new Date(NOW.getTime() + 60 * DAY_MS); // ya lleva ~58 días vencida
    const summary = await runDueReminders({ now: muchLater, mailer, overdueMaxDays: 30 });

    expect(summary).toMatchObject({ sent: 0, skippedTooOld: 1 });
    expect(sent).toHaveLength(1);
    expect((await remindedAt(order.id))?.toISOString()).toBe(mark!.toISOString());
  });

  it("modo diario: el tope también corta el reenvío diario cuando la cuenta cruza el límite", async () => {
    const w = await makeWholesaler();
    await makeCreditOrder({ wholesalerId: w.id, dueOffsetMs: -29 * DAY_MS - 1000 });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer, repeatDaily: true, overdueMaxDays: 30 }); // 29 días: se avisa
    await runDueReminders({ now: new Date(NOW.getTime() + DAY_MS), mailer, repeatDaily: true, overdueMaxDays: 30 }); // 30 días: se avisa
    await runDueReminders({ now: new Date(NOW.getTime() + 2 * DAY_MS), mailer, repeatDaily: true, overdueMaxDays: 30 }); // 31: ya no

    expect(sent).toHaveLength(2);
  });
});

describe("REMINDER_OVERDUE_MAX_DAYS — lectura y validación del valor", () => {
  const env = (value?: string) => ({ REMINDER_OVERDUE_MAX_DAYS: value }) as NodeJS.ProcessEnv;

  it("ausente o vacío = sin tope; un entero >= 0 se acepta", () => {
    expect(parseOverdueMaxDays(env(undefined))).toBeUndefined();
    expect(parseOverdueMaxDays(env(""))).toBeUndefined();
    expect(parseOverdueMaxDays(env("   "))).toBeUndefined();
    expect(parseOverdueMaxDays(env("60"))).toBe(60);
    expect(parseOverdueMaxDays(env(" 90 "))).toBe(90);
    expect(parseOverdueMaxDays(env("0"))).toBe(0);
  });

  it("un valor inválido LANZA error (no se ignora en silencio: sería correr sin la protección)", () => {
    for (const bad of ["abc", "-1", "1.5", "30 días", "NaN"]) {
      expect(() => parseOverdueMaxDays(env(bad)), bad).toThrow(/REMINDER_OVERDUE_MAX_DAYS inválido/);
    }
  });

  it("el scheduler NO programa el job si el valor es inválido, y sí si es válido o está vacío", () => {
    for (const task of cron.getTasks().values()) task.destroy();

    startScheduler({ REMINDER_OVERDUE_MAX_DAYS: "treinta" } as NodeJS.ProcessEnv);
    expect(cron.getTasks().size).toBe(0);

    startScheduler({ REMINDER_OVERDUE_MAX_DAYS: "60" } as NodeJS.ProcessEnv);
    expect(cron.getTasks().size).toBe(1);
    for (const task of cron.getTasks().values()) task.destroy();

    startScheduler({ REMINDER_OVERDUE_MAX_DAYS: "" } as NodeJS.ProcessEnv);
    expect(cron.getTasks().size).toBe(1);
    for (const task of cron.getTasks().values()) task.destroy();
  });
});

describe("Consistencia con el semáforo: el job y classifyReceivable usan el mismo umbral", () => {
  it("en cada borde (-1 ms, 0, +1 ms, +7 días, +7 días +1 ms) el tipo de aviso coincide con el color del semáforo", async () => {
    const w = await makeWholesaler();
    const offsets = [-1, 0, 1, 7 * DAY_MS - 1, 7 * DAY_MS, 7 * DAY_MS + 1, 30 * DAY_MS];
    const orders: { dueOffsetMs: number; order: Awaited<ReturnType<typeof makeCreditOrder>> }[] = [];
    for (const dueOffsetMs of offsets) orders.push({ dueOffsetMs, order: await makeCreditOrder({ wholesalerId: w.id, dueInDays: null, dueOffsetMs }) });
    const { mailer, sent } = fakeMailer();

    await runDueReminders({ now: NOW, mailer });

    for (const { dueOffsetMs, order } of orders) {
      const color = classifyReceivable(order, NOW);
      const mail = sent.find((m) => m.subject.includes(order.orderNumber));
      const expected = color === "VENCIDO" ? "pago vencido" : color === "POR_VENCER" ? "por vencer" : null;
      if (expected === null) expect(mail, `offset ${dueOffsetMs} (${color})`).toBeUndefined();
      else expect(mail?.subject, `offset ${dueOffsetMs} (${color})`).toContain(expected);
    }
    // Y los bordes concretos: 0 y 7 días exactos → por vencer; -1 ms → vencida; +7 días +1 ms → nada.
    const kindAt = (ms: number) => sent.find((m) => m.subject.includes(orders.find((o) => o.dueOffsetMs === ms)!.order.orderNumber))?.subject;
    expect(kindAt(-1)).toContain("pago vencido");
    expect(kindAt(0)).toContain("por vencer");
    expect(kindAt(7 * DAY_MS)).toContain("por vencer");
    expect(kindAt(7 * DAY_MS + 1)).toBeUndefined();
  });
});

describe("Scheduler", () => {
  const stopAll = () => {
    for (const task of cron.getTasks().values()) task.destroy();
  };
  afterEach(stopAll);

  it("programa UN job diario (por defecto 08:00 Guayaquil) y respeta REMINDERS_ENABLED=false / cron inválido", () => {
    startScheduler({ REMINDERS_ENABLED: "false" } as NodeJS.ProcessEnv);
    expect(cron.getTasks().size).toBe(0);

    startScheduler({ REMINDER_CRON: "esto no es un cron" } as NodeJS.ProcessEnv);
    expect(cron.getTasks().size).toBe(0);

    startScheduler({} as NodeJS.ProcessEnv);
    expect(cron.getTasks().size).toBe(1);
  });

  it("createApp() NO arranca ningún job (solo server.ts lo hace): los tests nunca disparan uno real", async () => {
    stopAll();
    const { createApp } = await import("../src/app");
    createApp();
    expect(cron.getTasks().size).toBe(0);
  });
});
