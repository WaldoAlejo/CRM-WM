// Semáforo de cuentas por cobrar: bordes EXACTOS con `now` inyectado (el
// clasificador es una función pura, así que los milisegundos se controlan).
import { describe, expect, it } from "vitest";
import { classifyReceivable, DUE_SOON_WINDOW_DAYS, dueSoonUpperBound } from "../src/lib/receivableStatus";

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-22T13:00:00.000Z");
const at = (offsetMs: number) => new Date(NOW.getTime() + offsetMs);

type Input = Parameters<typeof classifyReceivable>[0];
const account = (over: Partial<Input> & { dueDate: Date | null }): Input => ({
  paymentMethod: "CREDITO",
  status: "DESPACHADO",
  paymentStatus: "PENDIENTE",
  ...over,
});

describe("classifyReceivable — los 4 estados y sus bordes", () => {
  it("el umbral es de 7 días (el mismo que usa el job de recordatorios)", () => {
    expect(DUE_SOON_WINDOW_DAYS).toBe(7);
    expect(dueSoonUpperBound(NOW).getTime() - NOW.getTime()).toBe(7 * DAY_MS);
  });

  it("PENDIENTE (neutro): faltan MÁS de 7 días — un milisegundo después de los 7 días ya es pendiente", () => {
    expect(classifyReceivable(account({ dueDate: at(7 * DAY_MS + 1) }), NOW)).toBe("PENDIENTE");
    expect(classifyReceivable(account({ dueDate: at(30 * DAY_MS) }), NOW)).toBe("PENDIENTE");
    expect(classifyReceivable(account({ dueDate: at(60 * DAY_MS) }), NOW)).toBe("PENDIENTE");
  });

  it("POR_VENCER (ámbar): EXACTAMENTE a 7 días ya cuenta, y también entre 0 y 7 días", () => {
    expect(classifyReceivable(account({ dueDate: at(7 * DAY_MS) }), NOW)).toBe("POR_VENCER"); // borde superior
    expect(classifyReceivable(account({ dueDate: at(7 * DAY_MS - 1) }), NOW)).toBe("POR_VENCER");
    expect(classifyReceivable(account({ dueDate: at(3 * DAY_MS) }), NOW)).toBe("POR_VENCER");
    expect(classifyReceivable(account({ dueDate: at(1) }), NOW)).toBe("POR_VENCER");
  });

  it("EXACTAMENTE en la fecha de vencimiento todavía es POR_VENCER (0 días); un milisegundo después es VENCIDO", () => {
    expect(classifyReceivable(account({ dueDate: at(0) }), NOW)).toBe("POR_VENCER");
    expect(classifyReceivable(account({ dueDate: at(-1) }), NOW)).toBe("VENCIDO");
    expect(classifyReceivable(account({ dueDate: at(-DAY_MS) }), NOW)).toBe("VENCIDO");
    expect(classifyReceivable(account({ dueDate: at(-90 * DAY_MS) }), NOW)).toBe("VENCIDO");
  });

  it("COMPLETADO (verde): saldo pagado en su totalidad, sin importar la fecha (futura, hoy o pasada)", () => {
    for (const offset of [30 * DAY_MS, 7 * DAY_MS, 0, -1, -30 * DAY_MS]) {
      expect(classifyReceivable(account({ paymentStatus: "PAGADO", dueDate: at(offset) }), NOW), `offset ${offset}`).toBe("COMPLETADO");
    }
  });

  it("saldo PARCIAL vs. total pagado: un abono NO cambia el color por fecha, solo el pago completo lo pone verde", () => {
    // Con abono, el estado sigue dependiendo SOLO de la fecha.
    expect(classifyReceivable(account({ paymentStatus: "PARCIAL", dueDate: at(30 * DAY_MS) }), NOW)).toBe("PENDIENTE");
    expect(classifyReceivable(account({ paymentStatus: "PARCIAL", dueDate: at(7 * DAY_MS) }), NOW)).toBe("POR_VENCER");
    // Pagada por completo: verde.
    expect(classifyReceivable(account({ paymentStatus: "PAGADO", dueDate: at(7 * DAY_MS) }), NOW)).toBe("COMPLETADO");
  });

  it("cuenta YA VENCIDA con abono parcial: sigue ROJA (VENCIDO), no amarilla, aunque tenga algo pagado", () => {
    expect(classifyReceivable(account({ paymentStatus: "PARCIAL", dueDate: at(-1) }), NOW)).toBe("VENCIDO");
    expect(classifyReceivable(account({ paymentStatus: "PARCIAL", dueDate: at(-5 * DAY_MS) }), NOW)).toBe("VENCIDO");
    // Y solo el pago completo la saca del rojo.
    expect(classifyReceivable(account({ paymentStatus: "PAGADO", dueDate: at(-5 * DAY_MS) }), NOW)).toBe("COMPLETADO");
  });

  it("solo aplica a crédito ya despachado con fecha: contado, contra entrega, pendientes, canceladas o sin dueDate → null", () => {
    expect(classifyReceivable(account({ paymentMethod: "CONTADO", dueDate: at(-DAY_MS) }), NOW)).toBeNull();
    expect(classifyReceivable(account({ paymentMethod: "CONTRA_ENTREGA", dueDate: at(DAY_MS) }), NOW)).toBeNull();
    expect(classifyReceivable(account({ status: "PENDIENTE", dueDate: at(DAY_MS) }), NOW)).toBeNull();
    expect(classifyReceivable(account({ status: "CANCELADO", dueDate: at(DAY_MS) }), NOW)).toBeNull();
    expect(classifyReceivable(account({ dueDate: null }), NOW)).toBeNull();
  });
});
