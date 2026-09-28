import { prisma } from "../../lib/prisma";
import { renderFiscalPdf } from "./ride";
import { sendConfiguredMail } from "./mail.service";
import type { FiscalSnapshot } from "./xml";

// No invoice is recreated when email fails. Failed attempts remain visible for a manual resend.
export async function deliverAuthorizedDocument(id: string) {
  const claimed = await prisma.fiscalDocument.updateMany({ where: { id, status: "AUTHORIZED", cancellationStatus: "NONE", deliveries: { none: {} }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: new Date() } }] }, data: { lockedUntil: new Date(Date.now() + 90000) } });
  if (!claimed.count) return;
  try {
    const doc = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id }, include: { issuer: true } });
    if (!doc.recipientEmail || !doc.issuer.mailProfileId || !doc.authorizedXml) return;
    await sendConfiguredMail(doc.issuer.mailProfileId, { to: doc.recipientEmail,
      subject: `Comprobante ${doc.number} — ${(doc.snapshot as unknown as FiscalSnapshot).issuer.legalName}`,
      text: `Adjuntamos su comprobante electrónico ${doc.number}.`,
      attachments: [{ filename: `${doc.number}.xml`, content: Buffer.from(doc.authorizedXml), contentType: "application/xml" }, { filename: `${doc.number}.pdf`, content: await renderFiscalPdf(doc), contentType: "application/pdf" }],
    }, id);
  } catch { /* The mail attempt records a safe error for the administrator. */ }
  finally { await prisma.fiscalDocument.update({ where: { id }, data: { lockedUntil: null } }); }
}
