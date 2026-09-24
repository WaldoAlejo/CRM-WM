import { Prisma } from "@prisma/client";
import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { dispatchDocument, paymentDocument } from "../src/modules/documents/documents.service";
import { renderDocumentPdf } from "../src/modules/documents/documentPdf";

const d = (n: number) => new Prisma.Decimal(n);
function order(): Parameters<typeof dispatchDocument>[0] {
  return {
    id: "order", orderNumber: "OD-000001", origin: "NORMAL", status: "DESPACHADO",
    dispatchDate: new Date("2026-09-23T15:00:00Z"), createdAt: new Date("2026-09-22T15:00:00Z"),
    shippingProvince: "Guayas", shippingCity: "Guayaquil", paymentMethod: "CREDITO", creditDays: 30,
    dueDate: new Date("2026-10-23T15:00:00Z"), wholesaler: { businessName: "Cliente", ruc: "0990000000001" }, finalCustomer: null,
    items: [{ quantity: 2, unitPrice: d(201), variant: { sku: "WM-001", label: "Plomo", product: { name: "Producto" } } }],
    payments: [
      { id: "p1", amount: d(100), method: "efectivo", paidAt: new Date("2026-09-23"), createdAt: new Date("2026-09-23T10:00Z") },
      { id: "p2", amount: d(302), method: "transferencia", paidAt: new Date("2026-09-21"), createdAt: new Date("2026-09-24T10:00Z") },
      { id: "p3", amount: d(-50), method: "reembolso", paidAt: new Date("2026-09-25"), createdAt: new Date("2026-09-25T10:00Z") },
    ], shipment: null,
  };
}

// Decode actual PDFKit content streams, including its hex-encoded text, to
// verify rendered content instead of searching an opaque compressed buffer.
function pdfText(buffer: Buffer) {
  return [...buffer.toString("latin1").matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].map(match => {
    const stream = inflateSync(Buffer.from(match[1], "latin1")).toString("latin1");
    return [...stream.matchAll(/<([a-f\d]+)>/gi)].map(m => Buffer.from(m[1], "hex").toString("latin1")).join("");
  }).join("\n");
}

describe("Documentos operativos", () => {
  it("documenta la entrega en consignación sin saldo por cobrar", () => {
    const o = order(); o.paymentMethod = "CONSIGNACION"; o.dueDate = null; o.payments = [];
    const doc = dispatchDocument(o);
    expect(doc.fields).toContainEqual(["Condición", "Consignación"]);
    expect(doc.totals).toEqual([["Valor referencial en consignación", "USD 402.00"]]);
    expect(doc.notices.join(" ")).toContain("no genera deuda");
  });
  it("usa precios finales y condiciones sin publicar costos ni notas privadas", async () => {
    const o = order();
    Object.assign(o, { notes: "PRIVATE-NOTE", amountPaid: d(99999) });
    Object.assign(o.items[0], { unitCostSnapshot: d(170), landedCostSnapshot: d(180), markupPct: d(90), discountPct: d(25) });
    const doc = dispatchDocument(o);
    expect(doc.rows[0]).toEqual(["WM-001 · Producto · Plomo", "2", "USD 201.00", "USD 402.00"]);
    expect(doc.totals).toContainEqual(["Saldo pendiente", "USD 50.00"]);
    expect(doc.fields).toContainEqual(["Condición", "Crédito de 30 días"]);
    const text = pdfText(await renderDocumentPdf(doc));
    expect(text).toContain("USD 402.00");
    expect(text).not.toContain("170.00");
    expect(text).not.toContain("180.00");
    expect(text).not.toContain("PRIVATE-NOTE");
    expect(text).not.toContain("99999");
  });
  it("conserva el recibo parcial tras pago total retroactivo y posterior reverso", () => {
    const o = order();
    const partial = paymentDocument(o, "p1");
    expect(partial.title).toBe("Comprobante de pago parcial");
    expect(partial.totals).toContainEqual(["Saldo después de este registro", "USD 302.00"]);
    const full = paymentDocument(o, "p2");
    expect(full.title).toBe("Comprobante de pago total");
    expect(full.totals).toContainEqual(["Saldo después de este registro", "USD 0.00"]);
    const refund = paymentDocument(o, "p3");
    expect(refund.title).toContain("reembolso");
    expect(refund.totals).toContainEqual(["Saldo después de este registro", "USD 50.00"]);
    expect(() => paymentDocument(o, "otra-orden")).toThrow("Pago no encontrado");
  });
  it("identifica exceso de pago, cobros cero y decimales sin errores de flotante", () => {
    const o = order();
    o.items[0].unitPrice = d(0.1); o.items[0].quantity = 3;
    o.payments = [o.payments[0]]; o.payments[0].amount = d(0.4);
    expect(paymentDocument(o, "p1").totals).toContainEqual(["Excedente después de este registro", "USD 0.10"]);
    o.payments[0].amount = d(0);
    expect(paymentDocument(o, "p1").title).toBe("Registro de cobro sin importe");
  });
  it("no representa pendientes, cancelaciones y cargos de consignación como entregas", () => {
    const o = order(); o.status = "PENDIENTE"; o.dueDate = null;
    expect(dispatchDocument(o).title).toBe("Orden pendiente de despacho");
    expect(dispatchDocument(o).fields).toContainEqual(["Vencimiento", "Se establece al confirmar el despacho"]);
    o.status = "CANCELADO";
    expect(dispatchDocument(o).notices.join(" ")).toContain("no constituye una solicitud de pago");
    o.status = "DESPACHADO"; o.origin = "CONSIGNACION_LIQUIDACION";
    expect(dispatchDocument(o).title).toBe("Liquidación de consignación");
    expect(dispatchDocument(o).notices.join(" ")).toContain("No representa una nueva salida");
  });
  it("pagina tablas largas, repite encabezados y conserva la última fila", async () => {
    const doc = dispatchDocument(order());
    doc.rows = Array.from({ length: 130 }, (_, i) => [`PRODUCT-${i} ${"Descripción larga ".repeat(8)}`, "10", "USD 20.00", "USD 200.00"]);
    const buffer = await renderDocumentPdf(doc);
    expect(buffer.subarray(0, 5).toString()).toBe("%PDF-");
    const text = pdfText(buffer);
    expect(text).toContain("PRODUCT-129");
    expect(text.match(/Precio unitario/g)!.length).toBeGreaterThan(2);
    expect(text).toContain("Página 2 de");
  });
});
