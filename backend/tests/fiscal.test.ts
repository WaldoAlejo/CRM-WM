import request from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app";
import { createTestUser, createCategoryFixture, createProductFixture, createVariantWithIngreso, createWholesalerFixture, createCourierFixture, prisma, resetDatabase } from "./helpers";
import { testCertificate } from "./fiscalFixtures";
import { callSri } from "../src/modules/fiscal/sri";
vi.mock("../src/modules/fiscal/sri", () => ({ callSri: vi.fn() }));

const app = createApp(); let p12: Buffer;
beforeAll(() => { p12 = testCertificate(); process.env.SETTINGS_ENCRYPTION_KEY = "ab".repeat(32); process.env.FISCAL_PRODUCTION_ENABLED = "false"; });
afterEach(async () => { vi.mocked(callSri).mockReset(); await resetDatabase(); });
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const issuerBody = (ruc = "1790012345001") => ({ ruc, legalName: "EMPRESA PRUEBAS", address: "Quito", accountingRequired: true, regime: "GENERAL", environment: "1", mailProfileId: null });
async function configuredIssuer(token: string, ruc?: string) {
  const created = await request(app).post("/api/settings/issuers").set(auth(token)).send(issuerBody(ruc));
  expect(created.status).toBe(201); const id = created.body.id;
  for (const documentType of ["01", "04", "06"]) {
    const response = await request(app).post(`/api/settings/issuers/${id}/series`).set(auth(token)).send({ environment: "1", documentType, establishment: "001", emissionPoint: "001", address: "Quito", lastNumber: 0 });
    expect(response.status).toBe(201);
  }
  const cert = await request(app).post(`/api/settings/issuers/${id}/certificate`).set(auth(token)).field("password", "test-password").field("confirmedRepresentative", "true").attach("certificate", p12, "test.p12");
  expect(cert.status).toBe(201);
  const activation = await request(app).post(`/api/settings/issuers/${id}/activate`).set(auth(token)).send({ verified: true }); expect(activation.status).toBe(200);
  return id;
}
async function orderFixture(token: string, paymentMethod = "CREDITO") {
  const { category } = await createCategoryFixture(); const product = await createProductFixture({ categoryId: category.id });
  await prisma.product.update({ where: { id: product.id }, data: { ivaCode: "4", ivaRate: 15 } });
  const variant = await createVariantWithIngreso({ productId: product.id, quantity: 20, unitCost: 3 }); const wholesaler = await createWholesalerFixture();
  await prisma.wholesaler.update({ where: { id: wholesaler.id }, data: { address: "Guayaquil", ruc: "1790012346001" } });
  const response = await request(app).post("/api/dispatch-orders").set(auth(token)).send({ buyerType: "MAYORISTA", wholesalerId: wholesaler.id, paymentMethod, creditDays: 30, shippingProvince: "Guayas", shippingCity: "Guayaquil", items: [{ variantId: variant.id, quantity: 3, unitPrice: 10, priceType: "MAYORISTA" }] });
  expect(response.status).toBe(201); return response.body;
}
describe("configuración fiscal y correo", () => {
  it("solo administradores y CEO acceden a la configuración y comprobantes", async () => {
    const { token } = await createTestUser("OPERATOR");
    for (const path of ["/api/settings", "/api/fiscal-documents", "/api/fiscal-documents/tax-products"]) expect((await request(app).get(path).set(auth(token))).status).toBe(403);
    expect((await request(app).get("/api/settings")).status).toBe(401);
  });
  it("guarda SMTP cifrado, preserva contraseña vacía y no la expone", async () => {
    const { token } = await createTestUser("ADMIN");
    const body = { name: "Cuenta", host: "smtp.example.invalid", port: 587, security: "STARTTLS", username: "user", password: "smtp-password", fromName: "Empresa", fromEmail: "test@example.invalid", enabled: true };
    const created = await request(app).post("/api/settings/mail").set(auth(token)).send(body); expect(created.status).toBe(201);
    expect(created.body.hasPassword).toBe(true); expect(JSON.stringify(created.body)).not.toContain("smtp-password"); expect(created.body.passwordEncrypted).toBeUndefined();
    const stored = await prisma.mailProfile.findUniqueOrThrow({ where: { id: created.body.id } }); expect(stored.passwordEncrypted).not.toContain("smtp-password");
    expect((await request(app).put(`/api/settings/mail/${stored.id}`).set(auth(token)).send({ ...body, password: "" })).status).toBe(200);
    expect((await prisma.mailProfile.findUniqueOrThrow({ where: { id: stored.id } })).passwordEncrypted).toBe(stored.passwordEncrypted);
  });
  it("Resend: exige API key, verifica el dominio y envía por API HTTPS", async () => {
    const { token } = await createTestUser("ADMIN");
    const body = { name: "Resend", host: "", port: 1, security: "RESEND", username: "", fromName: "WM Global", fromEmail: "contact@wmglobalcorp.com", enabled: true };
    expect((await request(app).post("/api/settings/mail").set(auth(token)).send({ ...body, host: "api.resend.com" })).status).toBe(400);
    const created = await request(app).post("/api/settings/mail").set(auth(token)).send({ ...body, host: "api.resend.com", password: "re_test_key" });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ host: "api.resend.com", port: 443, username: "", hasPassword: true });
    const fetchMock = vi.spyOn(globalThis, "fetch");
    try {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ name: "wmglobalcorp.com", status: "pending" }] }), { status: 200 }));
      const pending = await request(app).post(`/api/settings/mail/${created.body.id}/verify`).set(auth(token));
      expect(pending.status).toBe(400); expect(pending.body.error).toContain("no está verificado");
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ name: "wmglobalcorp.com", status: "verified" }] }), { status: 200 }));
      expect((await request(app).post(`/api/settings/mail/${created.body.id}/verify`).set(auth(token))).status).toBe(200);
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: "email-1" }), { status: 200 }));
      expect((await request(app).post(`/api/settings/mail/${created.body.id}/test`).set(auth(token)).send({ recipient: "destino@example.com" })).status).toBe(200);
      const [url, init] = fetchMock.mock.calls[2];
      expect(url).toBe("https://api.resend.com/emails");
      expect((init!.headers as Record<string, string>).Authorization).toBe("Bearer re_test_key");
      expect(JSON.parse(String(init!.body))).toMatchObject({ from: "WM Global <contact@wmglobalcorp.com>", to: ["destino@example.com"] });
      expect((await prisma.mailDelivery.findFirstOrThrow()).status).toBe("SENT");
    } finally { fetchMock.mockRestore(); }
  });
  it("una firma inválida conserva la vigente y el cambio de RUC se rechaza", async () => {
    const { token } = await createTestUser("ADMIN"); const id = await configuredIssuer(token);
    const previous = await prisma.fiscalCertificate.findFirstOrThrow({ where: { issuerId: id, retiredAt: null } });
    const response = await request(app).post(`/api/settings/issuers/${id}/certificate`).set(auth(token)).field("password", "incorrect").field("confirmedRepresentative", "true").attach("certificate", p12, "bad.p12");
    expect(response.status).toBe(400); expect((await prisma.fiscalCertificate.findFirstOrThrow({ where: { issuerId: id, retiredAt: null } })).id).toBe(previous.id);
    const config = await request(app).get("/api/settings").set(auth(token)); expect(JSON.stringify(config.body)).not.toContain("p12Encrypted"); expect(JSON.stringify(config.body)).not.toContain("passwordEncrypted");
    expect((await request(app).put(`/api/settings/issuers/${id}`).set(auth(token)).send(issuerBody("1790012346001"))).status).toBe(409);
  });
  it("cambiar empresa conserva emisor e impuestos del pedido anterior", async () => {
    const { token } = await createTestUser("ADMIN"); const first = await configuredIssuer(token); const order = await orderFixture(token); const second = await configuredIssuer(token, "1790012346001");
    expect((await prisma.fiscalSettings.findUniqueOrThrow({ where: { id: 1 } })).activeIssuerId).toBe(second);
    expect((await prisma.dispatchOrder.findUniqueOrThrow({ where: { id: order.id } })).fiscalIssuerId).toBe(first);
  });
});
describe("facturas vinculadas a la venta", () => {
  it("crédito genera borrador sin duplicar stock; cuenta por cobrar incluye IVA", async () => {
    const { token } = await createTestUser("ADMIN"); await configuredIssuer(token); const order = await orderFixture(token);
    expect(await prisma.fiscalDocument.count()).toBe(0);
    expect((await request(app).post(`/api/dispatch-orders/${order.id}/confirm`).set(auth(token)).send({})).status).toBe(200);
    const doc = await prisma.fiscalDocument.findFirstOrThrow(); expect(doc.total.toFixed(2)).toBe("34.50"); expect(doc.status).toBe("DRAFT");
    const detail = await request(app).get(`/api/dispatch-orders/${order.id}`).set(auth(token)); expect(Number(detail.body.orderTotal)).toBe(34.5);
    await request(app).post(`/api/fiscal-documents/orders/${order.id}/invoice`).set(auth(token)); expect(await prisma.fiscalDocument.count()).toBe(1);
  });
  it("contra entrega espera aceptación, no factura al salir ni duplica por doble entrega", async () => {
    const { token } = await createTestUser("ADMIN"); await configuredIssuer(token); const order = await orderFixture(token, "CONTRA_ENTREGA"); const courier = await createCourierFixture();
    const confirmed = await request(app).post(`/api/dispatch-orders/${order.id}/confirm`).set(auth(token)).send({ courierId: courier.id }); expect(confirmed.status).toBe(200);
    expect(await prisma.fiscalDocument.count()).toBe(0);
    const shipment = await prisma.shipment.findFirstOrThrow({ where: { dispatchOrderId: order.id } }); expect(shipment.codAmountExpected?.toFixed(2)).toBe("34.50");
    const delivered = await request(app).post(`/api/shipments/${shipment.id}/deliver`).set(auth(token)).send({ codAmountCollected: 34.5 }); expect(delivered.status).toBe(200);
    expect(await prisma.fiscalDocument.count()).toBe(1);
    expect((await request(app).post(`/api/shipments/${shipment.id}/deliver`).set(auth(token)).send({ codAmountCollected: 34.5 })).status).toBe(409);
    expect(await prisma.payment.count()).toBe(1);
  });
  it("firma y reintenta la misma clave, y limita las notas parciales", async () => {
    const { token } = await createTestUser("ADMIN"); await configuredIssuer(token); const order = await orderFixture(token);
    await request(app).post(`/api/dispatch-orders/${order.id}/confirm`).set(auth(token)).send({}); const doc = await prisma.fiscalDocument.findFirstOrThrow();
    vi.mocked(callSri).mockResolvedValueOnce({ state: "RECEIVED", message: "Recibida" });
    const issued = await request(app).post(`/api/fiscal-documents/${doc.id}/issue`).set(auth(token)).send({ paymentCode: "20" }); expect(issued.status).toBe(200); expect(issued.body.status).toBe("RECEIVED");
    const key = issued.body.accessKey;
    vi.mocked(callSri).mockResolvedValueOnce({ state: "AUTHORIZED", message: "Autorizada", authorization: key, xml: "<authorized/>", authorizedAt: new Date() });
    const retried = await request(app).post(`/api/fiscal-documents/${doc.id}/retry`).set(auth(token)); expect(retried.body.accessKey).toBe(key); expect(retried.body.status).toBe("AUTHORIZED");
    expect(await prisma.fiscalDocument.count()).toBe(1); expect((await prisma.fiscalSeries.findUniqueOrThrow({ where: { id: doc.seriesId } })).lastNumber).toBe(1);
    const itemId = (doc.snapshot as any).lines[0].itemId;
    const note = await request(app).post(`/api/fiscal-documents/${doc.id}/credit-note`).set(auth(token)).send({ reason: "Devolución parcial", lines: [{ itemId, quantity: 2 }] });
    expect(note.status).toBe(201);
    expect((await request(app).post(`/api/fiscal-documents/${doc.id}/credit-note`).set(auth(token)).send({ reason: "Exceso", lines: [{ itemId, quantity: 2 }] })).status).toBe(400);
    expect((await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe("AUTHORIZED");
    vi.mocked(callSri).mockResolvedValueOnce({ state: "RECEIVED", message: "Recibida" });
    const noteIssued = await request(app).post(`/api/fiscal-documents/${note.body.id}/issue`).set(auth(token)).send({}); expect(noteIssued.status).toBe(200);
    vi.mocked(callSri).mockResolvedValueOnce({ state: "AUTHORIZED", message: "Autorizada", authorization: noteIssued.body.accessKey, xml: "<authorized/>", authorizedAt: new Date() });
    await request(app).post(`/api/fiscal-documents/${note.body.id}/retry`).set(auth(token));
    const adjusted = await request(app).get(`/api/dispatch-orders/${order.id}`).set(auth(token)); expect(Number(adjusted.body.orderTotal)).toBe(11.5);
    await request(app).post(`/api/fiscal-documents/${note.body.id}/retry`).set(auth(token));
    expect((await prisma.dispatchOrder.findUniqueOrThrow({ where: { id: order.id } })).fiscalCreditTotal.toFixed(2)).toBe("23.00");
    }, 40000);
  it("no reenvía un comprobante recibido mientras el SRI lo procesa (error 70)", async () => {
    const { token } = await createTestUser("ADMIN"); await configuredIssuer(token); const order = await orderFixture(token);
    await request(app).post(`/api/dispatch-orders/${order.id}/confirm`).set(auth(token)).send({}); const doc = await prisma.fiscalDocument.findFirstOrThrow();
    vi.mocked(callSri).mockResolvedValueOnce({ state: "RECEIVED", message: "Recibida" });
    expect((await request(app).post(`/api/fiscal-documents/${doc.id}/issue`).set(auth(token)).send({ paymentCode: "20" })).body.status).toBe("RECEIVED");
    vi.mocked(callSri).mockResolvedValue({ state: "WAITING", message: "El SRI todavía no devuelve autorización." });
    for (let i = 0; i < 3; i++) await request(app).post(`/api/fiscal-documents/${doc.id}/retry`).set(auth(token));
    expect(vi.mocked(callSri).mock.calls.map(c => c[1])).toEqual(["reception", "authorization", "authorization", "authorization"]);
    const stored = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: doc.id }, include: { events: true } });
    expect(stored.status).toBe("WAITING"); expect(stored.events.filter(e => e.action === "WAITING")).toHaveLength(1);
    expect(stored.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(10000);
    // Tras 24 h sin respuesta se reenvía la misma clave una sola vez.
    await prisma.fiscalEvent.updateMany({ where: { documentId: doc.id, action: "RECEIVED" }, data: { createdAt: new Date(Date.now() - 25 * 3600000) } });
    vi.mocked(callSri).mockReset().mockResolvedValueOnce({ state: "WAITING", message: "Sin respuesta" }).mockResolvedValueOnce({ state: "RECEIVED", message: "70: en procesamiento" });
    await request(app).post(`/api/fiscal-documents/${doc.id}/retry`).set(auth(token));
    expect(vi.mocked(callSri).mock.calls.map(c => [c[1], c[2]])).toEqual([["authorization", stored.accessKey], ["reception", stored.accessKey]]);
  }, 40000);
  it("la guía no se emite con inicio de traslado anterior a su emisión y permite corregir las fechas", async () => {
    const { token } = await createTestUser("ADMIN"); await configuredIssuer(token); const order = await orderFixture(token);
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "America/Guayaquil" });
    const guide = await request(app).post(`/api/fiscal-documents/orders/${order.id}/guide`).set(auth(token)).send({ startDate: yesterday, endDate: today, origin: "Quito", destination: "Guayaquil", carrierName: "Transportista", carrierId: "1790012347001", carrierIdType: "04", plate: "ABC1234", reason: "Venta" });
    expect(guide.status).toBe(201);
    const rejected = await request(app).post(`/api/fiscal-documents/${guide.body.id}/issue`).set(auth(token)).send({});
    expect(rejected.status).toBe(400); expect(rejected.body.message ?? rejected.body.error).toMatch(/82/);
    expect(callSri).not.toHaveBeenCalled();
    expect((await request(app).patch(`/api/fiscal-documents/${guide.body.id}/transport`).set(auth(token)).send({ startDate: today, endDate: today })).status).toBe(200);
    vi.mocked(callSri).mockResolvedValueOnce({ state: "RECEIVED", message: "Recibida" });
    const issued = await request(app).post(`/api/fiscal-documents/${guide.body.id}/issue`).set(auth(token)).send({});
    expect(issued.status).toBe(200); expect(issued.body.number).toBe("001-001-000000001");
  }, 40000);
  it("error 45 libera el secuencial, permite avanzar la serie y valida la identificación", async () => {
    const { token } = await createTestUser("ADMIN"); const issuerId = await configuredIssuer(token); const order = await orderFixture(token);
    await request(app).post(`/api/dispatch-orders/${order.id}/confirm`).set(auth(token)).send({}); const doc = await prisma.fiscalDocument.findFirstOrThrow();
    const badBuyer = await request(app).patch(`/api/fiscal-documents/${doc.id}/buyer`).set(auth(token)).send({ name: "Comprador", identification: "171234567", identificationType: "05", address: "Quito", email: "" });
    expect(badBuyer.status).toBe(400);
    expect((await request(app).patch(`/api/fiscal-documents/${doc.id}/buyer`).set(auth(token)).send({ name: "Comprador", identification: "1712345678", identificationType: "05", address: "Quito", email: "" })).status).toBe(200);
    expect((await request(app).get(`/api/fiscal-documents/${doc.id}`).set(auth(token))).body.buyerWarning).toMatch(/dígito/);
    vi.mocked(callSri).mockResolvedValueOnce({ state: "REJECTED", message: "45: SECUENCIAL REGISTRADO " });
    const issued = await request(app).post(`/api/fiscal-documents/${doc.id}/issue`).set(auth(token)).send({ paymentCode: "20" });
    expect(issued.body.status).toBe("REJECTED"); expect(issued.body.number).toBe("001-001-000000001");
    vi.mocked(callSri).mockResolvedValueOnce({ state: "WAITING", message: "Sin registro" });
    expect((await request(app).post(`/api/fiscal-documents/${doc.id}/correct-rejected`).set(auth(token))).status).toBe(200);
    const released = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id: doc.id } });
    expect([released.status, released.number, released.accessKey]).toEqual(["DRAFT", null, null]);
    const series = await prisma.fiscalSeries.findFirstOrThrow({ where: { issuerId, documentType: "01" } });
    expect((await request(app).post(`/api/settings/issuers/${issuerId}/series/${series.id}/advance`).set(auth(token)).send({ lastNumber: 1 })).status).toBe(409);
    expect((await request(app).post(`/api/settings/issuers/${issuerId}/series/${series.id}/advance`).set(auth(token)).send({ lastNumber: 5 })).status).toBe(200);
    vi.mocked(callSri).mockResolvedValueOnce({ state: "RECEIVED", message: "Recibida" });
    const reissued = await request(app).post(`/api/fiscal-documents/${doc.id}/issue`).set(auth(token)).send({ paymentCode: "20" });
    expect(reissued.status).toBe(200); expect(reissued.body.number).toBe("001-001-000000006"); expect(reissued.body.accessKey).not.toBe(issued.body.accessKey);
  }, 40000);
});
