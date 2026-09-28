import { beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import * as xades from "xadesjs";
import { encryptSecret, decryptSecret } from "../src/modules/fiscal/secrets";
import { readCertificate } from "../src/modules/fiscal/certificates";
import { accessKey, buildXml, totals } from "../src/modules/fiscal/xml";
import { signXml, validateXml } from "../src/modules/fiscal/signing";
import { parseSriResponse } from "../src/modules/fiscal/sri";
import { computeOrderTotal } from "../src/lib/paymentRecalculation";
import { fiscalPollDelay } from "../src/modules/fiscal/documents.service";
import { issuerSchema } from "../src/modules/fiscal/settings.schemas";
import { checkIdentification, validCedula, validRuc } from "../src/modules/fiscal/identification";
import { testCertificate, testSnapshot } from "./fiscalFixtures";

let certificate: Buffer;
beforeAll(() => { certificate = testCertificate(); process.env.SETTINGS_ENCRYPTION_KEY = "ab".repeat(32); });
describe("protección de credenciales y firma", () => {
  it("cifra con nonce único y rechaza cambio de contexto o alteración", () => {
    const encrypted = encryptSecret("secret", "mail:1");
    expect(encrypted).not.toContain("secret"); expect(encrypted).not.toBe(encryptSecret("secret", "mail:1"));
    expect(decryptSecret(encrypted, "mail:1")).toBe("secret"); expect(() => decryptSecret(encrypted, "mail:2")).toThrow();
    const parts = encrypted.split("."); parts[3] = Buffer.from("tampered").toString("base64"); expect(() => decryptSecret(parts.join("."), "mail:1")).toThrow();
  });
  it("valida clave privada y vigencia, sin aceptar contraseña errónea", () => {
    expect(readCertificate(certificate, "test-password").subject).toContain("TEST ONLY");
    expect(() => readCertificate(certificate, "wrong-password")).toThrow();
    expect(() => readCertificate(testCertificate(true), "test-password")).toThrow();
    expect(() => readCertificate(Buffer.from("not-p12"), "test-password")).toThrow();
  });
});
describe("XML y firma SRI", () => {
  const date = new Date("2026-09-24T12:00:00-05:00");
  it("genera una clave de 49 dígitos con fecha Ecuador y módulo 11", () => {
    const key = accessKey(date, "01", testSnapshot.issuer.ruc, "1", "001", "001", 1, "12345678");
    expect(key).toHaveLength(49); expect(key.startsWith("2409202601")).toBe(true);
    let n = 0; [...key.slice(0, 48)].reverse().forEach((d, i) => n += Number(d) * (i % 6 + 2));
    const check = 11 - n % 11; expect(key.at(-1)).toBe(String(check === 11 ? 0 : check === 10 ? 1 : check));
  });
  it("coinciden base e IVA de factura con la cuenta por cobrar", () => {
    const result = totals(testSnapshot.lines);
    expect(result.total.toFixed(2)).toBe("34.50");
    expect(computeOrderTotal([{ unitPrice: new Prisma.Decimal(10), quantity: 3, ivaRate: new Prisma.Decimal(15) }]).equals(result.total)).toBe(true);
    expect(computeOrderTotal([{ unitPrice: new Prisma.Decimal(10), quantity: 3 }]).toFixed(2)).toBe("30.00");
  });
  for (const type of ["01", "04", "06"]) it(`valida ${type} contra XSD oficial y verifica XAdES`, async () => {
    const key = accessKey(date, type, testSnapshot.issuer.ruc, "1", "001", "001", 1);
    const xml = buildXml(testSnapshot, type, "1", date, "001-001-000000001", key);
    await validateXml(xml, type);
    const signed = await signXml(xml, certificate, "test-password");
    expect(signed).toContain("SignedProperties"); expect(signed).toContain("SigningCertificate");
    expect(signed.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    const signatureId = signed.match(/<ds:Signature[^>]* Id="([^"]+)"/)?.[1];
    expect(signatureId).toBeTruthy(); expect(signed).toContain(`Target="#${signatureId}"`);
    const document = xades.Parse(signed); const verifier = new xades.SignedXml(document);
    const ns = "http://www.w3.org/2000/09/xmldsig#";
    const references = document.getElementsByTagNameNS(ns, "Reference");
    expect(references.length).toBe(3);
    const keyInfoId = document.getElementsByTagNameNS(ns, "KeyInfo")[0].getAttribute("Id");
    expect(Array.from(references).some(r => r.getAttribute("URI") === `#${keyInfoId}`)).toBe(true);
    verifier.LoadXml(document.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0]);
    expect(await verifier.Verify()).toBe(true);
    const tampered = xades.Parse(signed.replace("Producto &amp; ejemplo", "Producto alterado"));
    const broken = new xades.SignedXml(tampered); broken.LoadXml(tampered.getElementsByTagNameNS("http://www.w3.org/2000/09/xmldsig#", "Signature")[0]);
    await expect(broken.Verify()).rejects.toThrow();
  });
  it("rechaza estructura XML inválida antes de firmar", async () => { await expect(validateXml('<factura id="comprobante" version="1.1.0"/>', "01")).rejects.toThrow(); });
});
describe("respuestas del SRI", () => {
  it("no confunde recepción con autorización", () => {
    expect(parseSriResponse('<Envelope><Body><validarComprobanteResponse><RespuestaRecepcionComprobante><estado>RECIBIDA</estado></RespuestaRecepcionComprobante></validarComprobanteResponse></Body></Envelope>', "reception", "key").state).toBe("RECEIVED");
  });
  it("rechaza respuesta correspondiente a otra clave", () => {
    expect(() => parseSriResponse('<Envelope><Body><autorizacionComprobanteResponse><RespuestaAutorizacionComprobante><claveAccesoConsultada>other</claveAccesoConsultada></RespuestaAutorizacionComprobante></autorizacionComprobanteResponse></Body></Envelope>', "authorization", "expected")).toThrow();
  });
  const authorization = (estado: string, key = "clave") => `<Envelope><Body><autorizacionComprobanteResponse><RespuestaAutorizacionComprobante><claveAccesoConsultada>
  ${key}
</claveAccesoConsultada><autorizaciones><autorizacion><estado>${estado}</estado><mensajes><mensaje><identificador>39</identificador><mensaje>FIRMA INVALIDA</mensaje></mensaje></mensajes></autorizacion></autorizaciones></RespuestaAutorizacionComprobante></autorizacionComprobanteResponse></Body></Envelope>`;
  it("reconoce RECHAZADO (ficha técnica) y NO AUTORIZADO como rechazo", () => {
    for (const estado of ["RECHAZADO", "NO AUTORIZADO"]) {
      const result = parseSriResponse(authorization(estado), "authorization", "clave");
      expect(result.state).toBe("REJECTED"); expect(result.message).toContain("39");
    }
    expect(parseSriResponse('<Envelope><Body><autorizacionComprobanteResponse><RespuestaAutorizacionComprobante><claveAccesoConsultada>clave</claveAccesoConsultada><numeroComprobantes>0</numeroComprobantes><autorizaciones/></RespuestaAutorizacionComprobante></autorizacionComprobanteResponse></Body></Envelope>', "authorization", "clave").state).toBe("WAITING");
  });
  it("espera de forma creciente entre consultas, con tope", () => {
    expect(fiscalPollDelay(1, 5)).toBe(5000); expect(fiscalPollDelay(3, 5)).toBe(20000); expect(fiscalPollDelay(30, 5)).toBe(900000);
  });
  it("bloquea entidades externas", () => { expect(() => parseSriResponse('<!DOCTYPE x SYSTEM "file:///secret"><Envelope/>', "authorization", "key")).toThrow(); });
});
describe("configuración del emisor según la ficha técnica", () => {
  const base = { ruc: "1790012345001", legalName: "EMPRESA", address: "Quito", accountingRequired: true, regime: "GENERAL", environment: "1", mailProfileId: null };
  it("acepta solo el número de resolución de agente de retención y contribuyente especial", () => {
    expect(issuerSchema.safeParse({ ...base, withholdingAgent: "1", specialTaxpayer: "12345" }).success).toBe(true);
    expect(issuerSchema.safeParse({ ...base, withholdingAgent: "", specialTaxpayer: "" }).success).toBe(true);
    for (const withholdingAgent of ["NAC-DNCRASC20-00000001", "00000001", "123456789"]) expect(issuerSchema.safeParse({ ...base, withholdingAgent }).success).toBe(false);
    expect(issuerSchema.safeParse({ ...base, specialTaxpayer: "Resolución 123" }).success).toBe(false);
  });
  it("rechaza RIMPE negocio popular porque el XSD oficial no admite su leyenda", async () => {
    expect(issuerSchema.safeParse({ ...base, regime: "RIMPE_POPULAR" }).success).toBe(false);
    const xml = buildXml({ ...testSnapshot, issuer: { ...testSnapshot.issuer, regime: "RIMPE_POPULAR" } }, "01", "1", new Date(), "001-001-000000001", accessKey(new Date(), "01", testSnapshot.issuer.ruc, "1", "001", "001", 1));
    await expect(validateXml(xml, "01")).rejects.toThrow(/contribuyenteRimpe/);
    const emprendedor = buildXml({ ...testSnapshot, issuer: { ...testSnapshot.issuer, regime: "RIMPE_EMPRENDEDOR", withholdingAgent: "1" } }, "01", "1", new Date(), "001-001-000000001", accessKey(new Date(), "01", testSnapshot.issuer.ruc, "1", "001", "001", 1));
    await validateXml(emprendedor, "01");
  });
});
describe("cálculo de IVA sin diferencias (error 52)", () => {
  it("redondea el IVA de cada tarifa sobre su base y la cuenta por cobrar coincide", async () => {
    const lines = ["a", "b", "c"].map(itemId => ({ ...testSnapshot.lines[0], itemId, quantity: 1, unitPrice: "0.03" }));
    const result = totals(lines);
    expect(result.details.map(d => d.value.toFixed(2))).toEqual(["0.00", "0.00", "0.00"]);
    expect(result.groups[0].base.toFixed(2)).toBe("0.09"); expect(result.groups[0].value.toFixed(2)).toBe("0.01");
    expect(result.total.toFixed(2)).toBe("0.10");
    expect(computeOrderTotal(lines.map(() => ({ unitPrice: new Prisma.Decimal("0.03"), quantity: 1, ivaRate: new Prisma.Decimal(15) }))).equals(result.total)).toBe(true);
    const date = new Date();
    await validateXml(buildXml({ ...testSnapshot, lines }, "01", "1", date, "001-001-000000001", accessKey(date, "01", testSnapshot.issuer.ruc, "1", "001", "001", 1)), "01");
  });
  it("separa tarifas distintas y la tarifa 0% no suma IVA", () => {
    const items = [{ unitPrice: new Prisma.Decimal("10.005"), quantity: 3, ivaRate: new Prisma.Decimal(15) }, { unitPrice: new Prisma.Decimal(7), quantity: 2, ivaRate: new Prisma.Decimal(0) }, { unitPrice: new Prisma.Decimal("1.11"), quantity: 1, ivaRate: new Prisma.Decimal(15) }];
    const lines = items.map((i, n) => ({ ...testSnapshot.lines[0], itemId: String(n), quantity: i.quantity, unitPrice: i.unitPrice.toFixed(6), ivaCode: i.ivaRate.isZero() ? "0" : "4", ivaRate: i.ivaRate.toString() }));
    const result = totals(lines);
    expect(result.groups.map(g => [g.rate, g.base.toFixed(2), g.value.toFixed(2)])).toEqual([["15", "31.13", "4.67"], ["0", "14.00", "0.00"]]);
    expect(computeOrderTotal(items).equals(result.total)).toBe(true);
  });
});
describe("identificación del comprador", () => {
  it("valida cédula y RUC por dígito verificador, incluido un RUC público real", () => {
    expect(validCedula("1712345675")).toBe(true); expect(validCedula("1712345678")).toBe(false); expect(validCedula("9912345675")).toBe(false);
    expect(validRuc("1712345675001")).toBe(true); expect(validRuc("1790012344001")).toBe(true); expect(validRuc("1760013210001")).toBe(true);
    expect(validRuc("1790012345001")).toBe(false); expect(validRuc("1712345675000")).toBe(false);
  });
  it("bloquea formato incorrecto y solo advierte por dígito verificador", () => {
    expect(checkIdentification("05", "171234567").error).toBeTruthy();
    expect(checkIdentification("04", "1712345675").error).toBeTruthy();
    expect(checkIdentification("06", "AB 123").error).toBeTruthy();
    expect(checkIdentification("05", "1712345678")).toEqual({ warning: expect.any(String) });
    expect(checkIdentification("04", "1790012344001")).toEqual({});
    expect(checkIdentification("06", "A1234567")).toEqual({});
  });
});
