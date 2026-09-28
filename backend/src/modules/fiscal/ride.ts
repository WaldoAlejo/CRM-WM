import PDFDocument from "pdfkit";
import bwipjs from "bwip-js/node";
import type { FiscalDocument } from "@prisma/client";
import { fiscalDate, totals, type FiscalSnapshot } from "./xml";

export async function renderFiscalPdf(doc: FiscalDocument): Promise<Buffer> {
  const s = doc.snapshot as unknown as FiscalSnapshot, t = totals(s.lines);
  const barcode = doc.accessKey ? await bwipjs.toBuffer({ bcid: "code128", text: doc.accessKey, scale: 3, height: 12, includetext: false, paddingwidth: 12, backgroundcolor: "FFFFFF" }) : null;
  return new Promise((resolve, reject) => {
    const pdf = new PDFDocument({ margin: 42, size: "A4" });
    const chunks: Buffer[] = [];
    pdf.on("data", c => chunks.push(c)); pdf.on("error", reject); pdf.on("end", () => resolve(Buffer.concat(chunks)));
    const line = (text: string, size = 10) => { if (pdf.y > 735) pdf.addPage(); pdf.fontSize(size).text(text).moveDown(0.4); };
    line(s.issuer.legalName, 18); if (s.issuer.tradeName) line(s.issuer.tradeName);
    line(`RUC: ${s.issuer.ruc}`); line(`Matriz: ${s.issuer.address}`); line(`Establecimiento: ${s.establishmentAddress}`);
    line(`Obligado a llevar contabilidad: ${s.issuer.accountingRequired ? "SÍ" : "NO"}`);
    if (s.issuer.specialTaxpayer) line(`Contribuyente especial: ${s.issuer.specialTaxpayer}`);
    if (s.issuer.withholdingAgent) line(`Agente de Retención Resolución No. ${s.issuer.withholdingAgent}`);
    if (s.issuer.regime !== "GENERAL") line(s.issuer.regime === "RIMPE_POPULAR" ? "CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE" : "CONTRIBUYENTE RÉGIMEN RIMPE");
    line({ "01": "FACTURA", "04": "NOTA DE CRÉDITO", "06": "GUÍA DE REMISIÓN" }[doc.documentType] ?? "COMPROBANTE", 16);
    line(doc.number ?? "BORRADOR — SIN VALIDEZ TRIBUTARIA", 13);
    line(`Ambiente: ${doc.environment === "1" ? "PRUEBAS — SIN VALIDEZ TRIBUTARIA" : "PRODUCCIÓN"}`);
    line("Emisión: NORMAL");
    line(`Estado: ${doc.status} / Anulación: ${doc.cancellationStatus}`);
    if (doc.status !== "AUTHORIZED") line("NO AUTORIZADO — NO ES UN RIDE AUTORIZADO", 12);
    line(`Fecha de emisión: ${fiscalDate(doc.issueDate)}`);
    if (doc.authorizationNumber) line(`Número de autorización: ${doc.authorizationNumber}`);
    if (doc.authorizedAt) line(`Autorización: ${doc.authorizedAt.toLocaleString("es-EC", { timeZone: "America/Guayaquil" })}`);
    if (doc.accessKey) {
      if (pdf.y > 650) pdf.addPage();
      if (barcode) { const y = pdf.y; pdf.image(barcode, 42, y, { fit: [480, 48] }); pdf.y = y + 54; }
      line(`Clave de acceso: ${doc.accessKey}`);
    }
    line(`Comprador / destinatario: ${s.buyer.name}`); line(`Identificación: ${s.buyer.identification}`); line(`Dirección: ${s.buyer.address}`);
    if (s.originalNumber) { line(`Documento modificado: ${s.originalNumber} del ${s.originalDate}`); line(`Motivo: ${s.reason}`); }
    if (s.transport) { const tr = s.transport; line(`Transportista: ${tr.carrierName} / ${tr.carrierId} / placa ${tr.plate}`); line(`Traslado: ${tr.startDate} a ${tr.endDate}`); line(`Desde: ${tr.origin} / Hasta: ${tr.destination}`); line(`Motivo: ${tr.reason}`); }
    for (const item of t.details) { line(`${item.code} — ${item.description}`); line(doc.documentType === "06" ? `Cantidad: ${item.quantity}` : `${item.quantity} × ${item.unitPrice} | Base: ${item.base.toFixed(2)} | IVA ${item.ivaRate}%: ${item.value.toFixed(2)}`); }
    if (doc.documentType !== "06") {
      line(`Subtotal sin impuestos: USD ${t.subtotal.toFixed(2)}`); line("Descuento adicional: USD 0.00");
      for (const g of t.groups) line(`IVA ${g.rate}% — Base ${g.base.toFixed(2)}: USD ${g.value.toFixed(2)}`);
      line(`TOTAL: USD ${t.total.toFixed(2)}`, 14);
      if (doc.documentType === "01") line(`Forma de pago SRI: ${s.paymentCode} / Plazo: ${s.creditDays} días`);
    }
    pdf.end();
  });
}
