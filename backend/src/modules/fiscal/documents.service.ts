import { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../utils/httpError";
import { accessKey, buildXml, fiscalDate, totals, type FiscalSnapshot } from "./xml";
import { decryptSecret } from "./secrets";
import { signXml, validateXml } from "./signing";
import { callSri } from "./sri";
import { recalculatePaymentStatus } from "../../lib/paymentRecalculation";
import { checkIdentification } from "./identification";

export async function fiscalOrderContext(tx: Prisma.TransactionClient, items: { variantId: string }[]) {
  const settings = await tx.fiscalSettings.findUnique({ where: { id: 1 }, include: { activeIssuer: true } });
  const issuer = settings?.activeIssuer;
  if (!issuer) return { issuerId: undefined, environment: undefined, taxes: new Map<string, { ivaCode: string; ivaRate: Prisma.Decimal }>() };
  if (!issuer.enabledForEmission) throw conflict("La empresa activa tiene cambios pendientes de validar. Revisa su configuración antes de crear nuevos despachos.");
  const variants = await tx.productVariant.findMany({ where: { id: { in: items.map(i => i.variantId) } }, include: { product: true } });
  const taxes = new Map<string, { ivaCode: string; ivaRate: Prisma.Decimal }>();
  for (const v of variants) {
    if (v.product.ivaCode === null || v.product.ivaRate === null) throw badRequest(`Configura el IVA de ${v.product.name} antes de crear un despacho con facturación.`);
    taxes.set(v.id, { ivaCode: v.product.ivaCode, ivaRate: v.product.ivaRate });
  }
  return { issuerId: issuer.id, environment: issuer.environment, taxes };
}

export async function captureInvoice(tx: Prisma.TransactionClient, orderId: string, userId?: string) {
  const order = await tx.dispatchOrder.findUniqueOrThrow({ where: { id: orderId }, include: { fiscalIssuer: true, wholesaler: true, finalCustomer: true, shipment: true, items: { include: { variant: { include: { product: true } } } } } });
  if (!order.fiscalIssuer || order.paymentMethod === "CONSIGNACION" || order.status !== "DESPACHADO" || order.replacesOrderId || order.origin === "CONSIGNACION_DEVOLUCION_NO_CONFORME") return null;
  if (order.paymentMethod === "CONTRA_ENTREGA" && order.shipment?.status !== "ENTREGADO") return null;
  const issuer = order.fiscalIssuer;
  const environment = order.fiscalEnvironment;
  if (!environment) throw conflict("El despacho no tiene un ambiente fiscal asignado.");
  const existing = await tx.fiscalDocument.findUnique({ where: { sourceKey: `invoice:${orderId}` } });
  if (existing) return existing;
  const series = await tx.fiscalSeries.findFirst({ where: { issuerId: issuer.id, environment, documentType: "01" }, orderBy: [{ establishment: "asc" }, { emissionPoint: "asc" }] });
  if (!series) throw conflict("Falta la serie de facturación del emisor asignado al despacho.");
  const buyer = order.wholesaler ?? order.finalCustomer!;
  const identification = order.wholesaler?.ruc ?? order.finalCustomer?.idNumber ?? "";
  const snapshot: FiscalSnapshot = {
    issuer, establishment: series.establishment, emissionPoint: series.emissionPoint, establishmentAddress: series.address,
    buyer: { name: order.wholesaler?.businessName ?? order.finalCustomer?.fullName ?? "", identification, identificationType: identification.length === 13 ? "04" : identification.length === 10 ? "05" : "06", address: buyer?.address ?? "", email: buyer?.email },
    lines: order.items.map(i => ({ itemId: i.id, code: i.variant.sku, description: `${i.variant.product.name} ${i.variant.label ?? ""}`.trim(), quantity: i.quantity, unitPrice: i.unitPrice.toFixed(6), ivaCode: i.ivaCode ?? "", ivaRate: i.ivaRate?.toString() ?? "" })),
    paymentCode: "", creditDays: order.creditDays ?? 0,
  };
  // Whitelist issuer snapshot: never persist current configuration or future credentials.
  snapshot.issuer = issuerSnapshot(issuer);
  return tx.fiscalDocument.create({ data: {
    issuerId: issuer.id, dispatchOrderId: order.id, seriesId: series.id, sourceKey: `invoice:${orderId}`, documentType: "01", environment,
    issueDate: new Date(), buyerName: snapshot.buyer.name, buyerIdentification: identification, recipientEmail: buyer?.email,
    total: totals(snapshot.lines).total, snapshot: snapshot as unknown as Prisma.InputJsonValue,
    events: { create: { action: "SALE_EVENT", message: "Venta registrada. Revisa los datos y el medio de pago para emitir el comprobante.", performedById: userId } },
  } });
}
export function issuerSnapshot(issuer: FiscalSnapshot["issuer"]): FiscalSnapshot["issuer"] {
  return { ruc: issuer.ruc, legalName: issuer.legalName, tradeName: issuer.tradeName, address: issuer.address, accountingRequired: issuer.accountingRequired, specialTaxpayer: issuer.specialTaxpayer, withholdingAgent: issuer.withholdingAgent, regime: issuer.regime };
}
export async function getFiscalDocument(id: string) {
  const row = await prisma.fiscalDocument.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: "desc" } }, deliveries: { orderBy: { createdAt: "desc" } }, corrections: { select: { id: true, number: true, status: true, total: true } }, original: { select: { id: true, number: true } } } });
  if (!row) throw notFound("Comprobante no encontrado");
  return row;
}
const sortableDate = (ddmmyyyy: string) => ddmmyyyy.split("/").reverse().join("");
export async function prepareIssue(id: string, paymentCode: string, userId?: string) {
  // Serialize with updates to drafts, sequence allocation and NC reservations.
  const result = await prisma.$transaction(async tx => {
    const claimed = await tx.fiscalDocument.updateMany({ where: { id, status: "DRAFT" }, data: { status: "PREPARING" } });
    if (!claimed.count) throw conflict("El documento ya fue preparado; consulta su estado.");
    const doc = await tx.fiscalDocument.findUniqueOrThrow({ where: { id }, include: { issuer: true } });
    if (!doc.issuer.enabledForEmission) throw conflict("Valida y activa la configuración del emisor antes de emitir.");
    if (doc.environment === "2" && process.env.FISCAL_PRODUCTION_ENABLED !== "true") throw conflict("La emisión en producción está desactivada en el servidor.");
    const snapshot = doc.snapshot as unknown as FiscalSnapshot;
    if (!snapshot.buyer.identification || !snapshot.buyer.name || !snapshot.buyer.address) throw badRequest("Completa identificación, nombre y dirección del comprador en el borrador.");
    if (snapshot.lines.some(l => !l.ivaCode || l.ivaRate === "")) throw badRequest("Falta IVA en las líneas del documento.");
    if (doc.documentType === "01" && !["01", "15", "16", "17", "18", "19", "20", "21"].includes(paymentCode)) throw badRequest("Selecciona el medio de pago SRI.");
    snapshot.paymentCode = paymentCode;
    if (snapshot.buyer.identification === "9999999999999") throw badRequest("Usa un comprador identificado para los despachos y sus posibles devoluciones.");
    const identification = doc.documentType === "06" ? {} : checkIdentification(snapshot.buyer.identificationType, snapshot.buyer.identification);
    if (identification.error) throw badRequest(`${identification.error} Corrige los datos del comprador en el borrador.`);
    const cert = await tx.fiscalCertificate.findFirst({ where: { issuerId: doc.issuerId, retiredAt: null, validFrom: { lte: new Date() }, validTo: { gt: new Date() } } });
    if (!cert?.p12Encrypted || !cert.passwordEncrypted) throw conflict("El emisor no tiene una firma vigente.");
    if (!doc.accessKey) {
      const incremented = await tx.fiscalSeries.updateMany({ where: { id: doc.seriesId, lastNumber: { lt: 999999999 } }, data: { lastNumber: { increment: 1 } } });
      if (!incremented.count) throw conflict("Se agotó la numeración de esta serie.");
    }
    const series = await tx.fiscalSeries.findUniqueOrThrow({ where: { id: doc.seriesId } });
    const number = doc.number ?? `${series.establishment}-${series.emissionPoint}-${String(series.lastNumber).padStart(9, "0")}`;
    const date = doc.accessKey ? doc.issueDate : new Date();
    if (doc.documentType === "06" && (!snapshot.transport || sortableDate(snapshot.transport.startDate) < sortableDate(fiscalDate(date)))) {
      throw badRequest("La fecha de inicio del traslado no puede ser anterior a la fecha de emisión de la guía (error SRI 82). Actualiza las fechas del traslado antes de emitir.");
    }
    const key = doc.accessKey ?? accessKey(date, doc.documentType, snapshot.issuer.ruc, doc.environment, series.establishment, series.emissionPoint, series.lastNumber);
    const xml = buildXml(snapshot, doc.documentType, doc.environment, date, number, key);
    await validateXml(xml, doc.documentType);
    const signedXml = await signXml(xml, Buffer.from(decryptSecret(cert.p12Encrypted, `p12:${cert.id}`), "base64"), decryptSecret(cert.passwordEncrypted, `p12-password:${cert.id}`));
    return tx.fiscalDocument.update({ where: { id }, data: { status: "QUEUED", attempts: 0, number, accessKey: key, issueDate: date, certificateId: cert.id, unsignedXml: xml, signedXml, snapshot: snapshot as unknown as Prisma.InputJsonValue, nextAttemptAt: new Date(), events: { create: { action: "ISSUED", message: "Comprobante firmado y registrado para transmisión inmediata.", performedById: userId } } } });
  }, { timeout: 30000 });
  await processFiscalDocument(result.id);
  return getFiscalDocument(result.id);
}

// Ficha técnica 7.4: parametrizable wait between reception and authorization queries.
export function fiscalPollDelay(attempts: number, baseSeconds = Number(process.env.FISCAL_AUTHORIZATION_WAIT_SECONDS) || 5) {
  return Math.min(baseSeconds * 2 ** Math.max(0, attempts - 1), 900) * 1000;
}
const PROCESSING_WINDOW = 24 * 60 * 60 * 1000;

export async function processFiscalDocument(id: string) {
  const now = new Date();
  const claim = await prisma.fiscalDocument.updateMany({ where: { id, status: { in: ["QUEUED", "RECEIVED", "WAITING"] }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] }, data: { lockedUntil: new Date(now.getTime() + 90000), attempts: { increment: 1 } } });
  if (!claim.count) return;
  let attempts = 1;
  try {
    const doc = await prisma.fiscalDocument.findUniqueOrThrow({ where: { id } });
    attempts = doc.attempts;
    if (doc.environment === "2" && process.env.FISCAL_PRODUCTION_ENABLED !== "true") throw new Error("Producción desactivada");
    const acknowledged = doc.status !== "QUEUED";
    // Query first on every retry, including an ambiguous reception timeout.
    let result = doc.attempts > 1 || acknowledged ? await callSri(doc.environment, "authorization", doc.accessKey!) : null;
    let sent = false;
    const send = () => { sent = true; return callSri(doc.environment, "reception", doc.accessKey!, doc.signedXml!); };
    if (!result) result = await send();
    else if (result.state === "WAITING") {
      // Code 70: once the SRI acknowledged the document, do not resend it while it is processed (up to 24 h).
      const received = acknowledged ? await prisma.fiscalEvent.findFirst({ where: { documentId: id, action: "RECEIVED" }, orderBy: { createdAt: "desc" } }) : null;
      if (!received || now.getTime() - received.createdAt.getTime() > PROCESSING_WINDOW) result = await send();
    }
    const done = result.state === "AUTHORIZED" || result.state === "REJECTED";
    // Every reception acknowledgement is recorded: it starts the 24 h processing window.
    const changed = sent || result.state !== doc.status || result.message !== doc.lastMessage;
    await prisma.$transaction(async tx => {
      await tx.fiscalDocument.update({ where: { id }, data: { status: result!.state, lastMessage: result!.message, authorizedXml: result!.xml, authorizationNumber: result!.authorization, authorizedAt: result!.authorizedAt, lockedUntil: null,
        nextAttemptAt: done ? null : new Date(Date.now() + fiscalPollDelay(doc.attempts)), events: changed ? { create: { action: result!.state, message: result!.message } } : undefined } });
      if (doc.dispatchOrderId && doc.documentType === "04" && result!.state === "AUTHORIZED") await reconcileFiscalCredits(tx, doc.dispatchOrderId);
    });
  } catch {
    await prisma.fiscalDocument.update({ where: { id }, data: { lockedUntil: null, nextAttemptAt: new Date(Date.now() + Math.max(60000, fiscalPollDelay(attempts))), lastMessage: "No se pudo confirmar la respuesta del SRI. Se consultará la misma clave antes de reintentar." } });
  }
}

export async function reconcileFiscalCredits(tx: Prisma.TransactionClient, orderId: string) {
  // Parent lock protects concurrent authorizations and cancellation reconciliations.
  await tx.dispatchOrder.update({ where: { id: orderId }, data: { updatedAt: new Date() } });
  const invoices = await tx.fiscalDocument.findMany({ where: { dispatchOrderId: orderId, documentType: "01", status: "AUTHORIZED" }, include: { corrections: { where: { status: "AUTHORIZED", cancellationStatus: { not: "CONFIRMED" } } } } });
  const credit = invoices.reduce((sum, invoice) => sum.plus(invoice.cancellationStatus === "CONFIRMED" ? invoice.total : invoice.corrections.reduce((n, c) => n.plus(c.total), new Prisma.Decimal(0))), new Prisma.Decimal(0));
  await tx.dispatchOrder.update({ where: { id: orderId }, data: { fiscalCreditTotal: credit } });
  await recalculatePaymentStatus(tx, orderId);
}

export async function createCreditNote(originalId: string, lines: { itemId: string; quantity: number }[], reason: string, userId?: string) {
  return prisma.$transaction(async tx => {
    // Lock the invoice so concurrent partial notes cannot exceed original quantities.
    const original = await tx.fiscalDocument.update({ where: { id: originalId }, data: { updatedAt: new Date() }, include: { corrections: true } });
    if (original.documentType !== "01" || original.status !== "AUTHORIZED" || ["REQUESTED", "CONFIRMED"].includes(original.cancellationStatus)) throw conflict("La nota requiere una factura autorizada sin trámite de anulación pendiente.");
    const snapshot = structuredClone(original.snapshot) as unknown as FiscalSnapshot;
    if (snapshot.buyer.identification === "9999999999999") throw badRequest("No se admite nota de crédito para consumidor final.");
    const quantities = new Map<string, number>();
    for (const correction of original.corrections.filter(c => c.status !== "VOID" && c.cancellationStatus !== "CONFIRMED")) {
      for (const l of (correction.snapshot as unknown as FiscalSnapshot).lines) quantities.set(l.itemId, (quantities.get(l.itemId) ?? 0) + l.quantity);
    }
    const seen = new Set<string>();
    snapshot.lines = lines.map(l => {
      const source = snapshot.lines.find(i => i.itemId === l.itemId);
      if (!source || seen.has(l.itemId) || l.quantity <= 0 || l.quantity + (quantities.get(l.itemId) ?? 0) > source.quantity) throw badRequest("Las cantidades de la nota exceden las unidades pendientes de acreditar.");
      seen.add(l.itemId); return { ...source, quantity: l.quantity };
    });
    snapshot.reason = reason; snapshot.originalNumber = original.number!; snapshot.originalDate = fiscalDate(original.issueDate);
    const series = await tx.fiscalSeries.findFirst({ where: { issuerId: original.issuerId, environment: original.environment, documentType: "04" }, orderBy: { id: "asc" } });
    if (!series) throw conflict("Falta una serie de notas de crédito para la empresa original.");
    snapshot.establishment = series.establishment; snapshot.emissionPoint = series.emissionPoint; snapshot.establishmentAddress = series.address;
    return tx.fiscalDocument.create({ data: { issuerId: original.issuerId, dispatchOrderId: original.dispatchOrderId, originalId, seriesId: series.id, sourceKey: `credit:${randomUUID()}`, documentType: "04", environment: original.environment, issueDate: new Date(), buyerName: original.buyerName, buyerIdentification: original.buyerIdentification, recipientEmail: original.recipientEmail, total: totals(snapshot.lines).total, snapshot: snapshot as unknown as Prisma.InputJsonValue,
      events: { create: { action: "DRAFT", message: reason, performedById: userId } } } });
  });
}
