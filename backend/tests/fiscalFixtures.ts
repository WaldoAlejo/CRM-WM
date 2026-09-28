import { generateKeyPairSync } from "crypto";
import forge from "node-forge";
import type { FiscalSnapshot } from "../src/modules/fiscal/xml";

export function testCertificate(expired = false) {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const cert = forge.pki.createCertificate();
  cert.publicKey = forge.pki.publicKeyFromPem(keys.publicKey); cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86400000 * 2); cert.validity.notAfter = new Date(Date.now() + (expired ? -1 : 365) * 86400000);
  const attrs = [{ name: "commonName", value: "TEST ONLY - NO FISCAL VALUE" }]; cert.setSubject(attrs); cert.setIssuer(attrs);
  cert.setExtensions([{ name: "keyUsage", digitalSignature: true }]);
  const key = forge.pki.privateKeyFromPem(keys.privateKey); cert.sign(key, forge.md.sha256.create());
  const asn = forge.pkcs12.toPkcs12Asn1(key, [cert], "test-password", { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(asn).getBytes(), "binary");
}
export const testSnapshot: FiscalSnapshot = {
  issuer: { ruc: "1790012345001", legalName: "EMPRESA PRUEBAS", address: "Quito", accountingRequired: true, regime: "GENERAL" },
  establishment: "001", emissionPoint: "001", establishmentAddress: "Quito",
  buyer: { name: "COMPRADOR PRUEBA", identification: "1712345678", identificationType: "05", address: "Guayaquil", email: "test@example.invalid" },
  lines: [{ itemId: "item", code: "SKU1", description: "Producto & ejemplo", quantity: 3, unitPrice: "10.00", ivaCode: "4", ivaRate: "15" }],
  paymentCode: "20", creditDays: 30, reason: "Devolución parcial", originalNumber: "001-001-000000001", originalDate: "24/09/2026",
  transport: { startDate: "24/09/2026", endDate: "25/09/2026", origin: "Quito", destination: "Guayaquil", carrierName: "Transportista", carrierId: "1790012345001", carrierIdType: "04", plate: "ABC1234", reason: "Consignación" },
};
