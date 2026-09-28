import forge from "node-forge";
import { createHash } from "crypto";
import { badRequest } from "../../utils/httpError";

export function readCertificate(buffer: Buffer, password: string, now = new Date()) {
  try {
    const p12 = forge.pkcs12.pkcs12FromAsn1(forge.asn1.fromDer(buffer.toString("binary")), password);
    const keys = [...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
      ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? [])];
    const certs = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    for (const bag of keys) {
      const privateKey = bag.key as forge.pki.rsa.PrivateKey | undefined;
      if (!privateKey || !privateKey.n || privateKey.n.bitLength() < 2048) continue;
      for (const certBag of certs) {
        const cert = certBag.cert;
        if (!cert) continue;
        const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
        if (!publicKey.n || !publicKey.n.equals(privateKey.n) || !publicKey.e.equals(privateKey.e)) continue;
        if (now < cert.validity.notBefore || now >= cert.validity.notAfter) throw new Error();
        const usage = cert.getExtension("keyUsage") as { digitalSignature?: boolean; nonRepudiation?: boolean } | null;
        const constraints = cert.getExtension("basicConstraints") as { cA?: boolean } | null;
        if (constraints?.cA || (usage && !usage.digitalSignature && !usage.nonRepudiation)) continue;
        const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
        const subject = cert.subject.attributes.map(a => `${a.shortName ?? a.name ?? a.type}=${a.value}`).join(", ");
        return {
          privateKeyPem: forge.pki.privateKeyToPem(privateKey),
          certificateBase64: Buffer.from(der, "binary").toString("base64"),
          subject, issuedBy: cert.issuer.attributes.map(a => `${a.shortName ?? a.name ?? a.type}=${a.value}`).join(", "),
          serialNumber: cert.serialNumber, fingerprint: createHash("sha256").update(Buffer.from(der, "binary")).digest("hex"),
          validFrom: cert.validity.notBefore, validTo: cert.validity.notAfter,
        };
      }
    }
    throw new Error();
  } catch { throw badRequest("El P12 o su contraseña no son válidos, no contiene una clave RSA de firma compatible o el certificado está fuera de vigencia."); }
}
