import { createPrivateKey, createPublicKey, webcrypto, randomUUID } from "crypto";
import * as xades from "xadesjs";
import { DOMParser, XMLSerializer, DOMImplementation } from "@xmldom/xmldom";
import xpath from "xpath";
import { readFileSync } from "fs";
import path from "path";
import { readCertificate } from "./certificates";
import { badRequest } from "../../utils/httpError";

xades.Application.setEngine("NodeJS", webcrypto as unknown as Parameters<typeof xades.Application.setEngine>[1]);
xades.setNodeDependencies({ DOMParser, XMLSerializer, DOMImplementation, xpath });
const loadValidator = () => import("libxml2-wasm");
let registered = false;
export async function validateXml(xml: string, type: string) {
  const file = { "01": "factura_V1.1.0.xsd", "04": "NotaCredito_V1.1.0.xsd", "06": "GuiaRemision_V1.1.0.xsd" }[type];
  if (!file || /<!DOCTYPE|<!ENTITY/i.test(xml)) throw badRequest("XML no permitido");
  const lib = await loadValidator();
  if (!registered) {
    lib.xmlRegisterInputProvider(new lib.XmlBufferInputProvider({ "xmldsig-core-schema.xsd": readFileSync(path.resolve(process.cwd(), "resources/sri/xmldsig-core-schema.xsd")) }));
    registered = true;
  }
  const schema = lib.XmlDocument.fromBuffer(readFileSync(path.resolve(process.cwd(), "resources/sri", file)));
  const doc = lib.XmlDocument.fromString(xml);
  const validator = lib.XsdValidator.fromDoc(schema);
  try { validator.validate(doc); }
  catch (error) {
    const details = (error as { details?: { message?: string }[] }).details?.map(d => d.message?.trim()).filter(Boolean).slice(0, 3).join(" | ");
    throw badRequest(`El comprobante no cumple el esquema oficial del SRI. Revisa los datos fiscales y longitudes de sus campos.${details ? ` Detalle: ${details.slice(0, 600)}` : ""}`);
  }
  finally { validator.dispose(); doc.dispose(); schema.dispose(); }
}
export async function signXml(xml: string, p12: Buffer, password: string) {
  const cert = readCertificate(p12, password);
  const der = createPrivateKey(cert.privateKeyPem).export({ format: "der", type: "pkcs8" });
  const algorithm = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-1" };
  const key = await webcrypto.subtle.importKey("pkcs8", der, algorithm, false, ["sign"]);
  const document = xades.Parse(xml);
  const signed = new xades.SignedXml();
  // QualifyingProperties@Target must point to this Signature Id (XAdES; see SRI ficha técnica, anexo 14).
  const signatureId = `Signature-${randomUUID()}`;
  signed.XmlSignature.Id = signatureId;
  signed.Properties!.Target = `#${signatureId}`;
  const publicKey = await webcrypto.subtle.importKey("spki", createPublicKey(cert.privateKeyPem).export({ format: "der", type: "spki" }), algorithm, true, ["verify"]);
  const certificateId = `Certificate-${randomUUID()}`;
  signed.XmlSignature.KeyInfo.Id = certificateId;
  const format = new xades.xml.DataObjectFormat();
  format.ObjectReference = "#Reference-Comprobante";
  format.Description = "contenido comprobante";
  format.MimeType = "text/xml";
  signed.SignedProperties.SignedDataObjectProperties.DataObjectFormats.Add(format);
  await signed.Sign(algorithm, key as unknown as Parameters<typeof signed.Sign>[1], document, {
    x509: [cert.certificateBase64],
    keyValue: publicKey as unknown as CryptoKey,
    signingCertificate: { certificate: cert.certificateBase64, digestAlgorithm: "SHA-1" },
    signingTime: { value: new Date() },
    references: [
      { id: "Reference-Comprobante", uri: "#comprobante", hash: "SHA-1", transforms: ["enveloped", "c14n"] },
      { uri: `#${certificateId}`, hash: "SHA-1", transforms: ["c14n"] },
    ],
  });
  // toString() drops the XML declaration, which the SRI ficha técnica (anexo 3) marks as mandatory.
  const output = signed.toString();
  return output.startsWith("<?xml") ? output : `<?xml version="1.0" encoding="UTF-8"?>${output}`;
}
