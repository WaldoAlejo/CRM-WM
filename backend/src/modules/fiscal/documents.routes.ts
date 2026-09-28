import { Router } from "express";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict } from "../../utils/httpError";
import { captureInvoice, createCreditNote, getFiscalDocument, issuerSnapshot, prepareIssue, processFiscalDocument, reconcileFiscalCredits } from "./documents.service";
import { fiscalDate, type FiscalSnapshot } from "./xml";
import { sendConfiguredMail } from "./mail.service";
import { renderFiscalPdf } from "./ride";
import { callSri } from "./sri";
import { checkIdentification } from "./identification";

export const fiscalDocumentsRouter = Router();
fiscalDocumentsRouter.use(requireAuth, requireRole(Role.ADMIN));
fiscalDocumentsRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
fiscalDocumentsRouter.get("/", asyncHandler(async (req, res) => {
  const filter = z.object({ issuerId: z.string().optional(), environment: z.enum(["1", "2"]).optional(), type: z.enum(["01", "04", "06"]).optional(), status: z.enum(["DRAFT", "QUEUED", "RECEIVED", "WAITING", "AUTHORIZED", "REJECTED", "VOID", "CANCELLED"]).optional(), q: z.string().max(200).optional(), orderId: z.string().optional(), from: z.string().date().optional(), to: z.string().date().optional(), page: z.coerce.number().int().min(1).default(1) }).parse(req.query);
  const where: Prisma.FiscalDocumentWhereInput = { issuerId: filter.issuerId, environment: filter.environment, documentType: filter.type, dispatchOrderId: filter.orderId,
    status: filter.status === "CANCELLED" ? undefined : filter.status, cancellationStatus: filter.status === "CANCELLED" ? "CONFIRMED" : undefined,
    issueDate: { gte: filter.from ? new Date(`${filter.from}T00:00:00-05:00`) : undefined, lte: filter.to ? new Date(`${filter.to}T23:59:59.999-05:00`) : undefined },
    OR: filter.q ? [{ buyerName: { contains: filter.q, mode: "insensitive" } }, { number: { contains: filter.q } }, { buyerIdentification: { contains: filter.q } }, { dispatchOrder: { orderNumber: { contains: filter.q, mode: "insensitive" } } }] : undefined };
  const [data, total] = await Promise.all([prisma.fiscalDocument.findMany({ where, skip: (filter.page - 1) * 30, take: 30, orderBy: { createdAt: "desc" }, select: { id: true, issuerId: true, issuer: { select: { legalName: true, ruc: true } }, number: true, documentType: true, environment: true, status: true, cancellationStatus: true, buyerName: true, total: true, issueDate: true, lastMessage: true, dispatchOrder: { select: { id: true, orderNumber: true } }, deliveries: { take: 1, orderBy: { createdAt: "desc" }, select: { status: true } } } }), prisma.fiscalDocument.count({ where })]);
  res.json({ data, total, page: filter.page });
}));
fiscalDocumentsRouter.get("/tax-products", asyncHandler(async (req, res) => {
  const q = z.string().max(200).parse(req.query.q ?? "");
  res.json(await prisma.product.findMany({ where: { deletedAt: null, OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] }, take: 100, orderBy: { name: "asc" }, select: { id: true, name: true, sku: true, ivaCode: true, ivaRate: true } }));
}));
fiscalDocumentsRouter.put("/tax-products/:id", asyncHandler(async (req, res) => {
  const data = z.object({ ivaCode: z.enum(["0", "2", "3", "4", "5", "6", "7", "8", "10"]), ivaRate: z.number().min(0).max(100) }).strict().parse(req.body);
  const rates: Record<string, number> = { "0": 0, "2": 12, "3": 14, "4": 15, "5": 5, "6": 0, "7": 0, "8": 8, "10": 13 };
  if (rates[data.ivaCode] !== data.ivaRate) throw badRequest("La tarifa no corresponde al código IVA seleccionado.");
  res.json(await prisma.$transaction(async tx => {
    const row = await tx.product.update({ where: { id: req.params.id }, data, select: { id: true, ivaCode: true, ivaRate: true } });
    await tx.auditLog.create({ data: { entityType: "ProductTax", entityId: row.id, action: "UPDATE", changes: data, performedById: req.user!.id } });
    return row;
  }));
}));
fiscalDocumentsRouter.post("/orders/:id/invoice", asyncHandler(async (req, res) => {
  const doc = await prisma.$transaction(async tx => {
    await tx.dispatchOrder.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
    return captureInvoice(tx, req.params.id, req.user!.id);
  });
  if (!doc) throw conflict("Este despacho todavía no es facturable, no tiene emisor asignado o requiere tratamiento especial.");
  res.json(doc);
}));
const short = z.string().trim().min(1).max(300);
const transportSchema = z.object({ startDate: z.string().date(), endDate: z.string().date(), origin: short, destination: short, carrierName: short, carrierId: z.string().regex(/^\d{10}(\d{3})?$/), carrierIdType: z.enum(["04", "05"]), plate: z.string().trim().min(3).max(20), reason: short }).strict().refine(d => d.endDate >= d.startDate, "La fecha final debe ser posterior a la inicial");
fiscalDocumentsRouter.post("/orders/:id/guide", asyncHandler(async (req, res) => {
  const input = transportSchema.parse(req.body);
  res.status(201).json(await prisma.$transaction(async tx => {
    const order = await tx.dispatchOrder.update({ where: { id: req.params.id }, data: { updatedAt: new Date() }, include: { fiscalIssuer: true, wholesaler: true, finalCustomer: true, items: { include: { variant: { include: { product: true } } } } } });
    if (!order.fiscalIssuer || order.status !== "PENDIENTE") throw conflict("La guía debe prepararse antes de despachar una orden con emisor asignado.");
    const issuer = order.fiscalIssuer;
    const environment = order.fiscalEnvironment;
    if (!environment) throw conflict("Falta el ambiente fiscal del despacho.");
    const series = await tx.fiscalSeries.findFirst({ where: { issuerId: issuer.id, environment, documentType: "06" }, orderBy: { id: "asc" } });
    if (!series) throw conflict("Falta la serie de guías.");
    const buyer = order.wholesaler ?? order.finalCustomer!;
    const identification = order.wholesaler?.ruc ?? order.finalCustomer?.idNumber ?? "";
    const snapshot: FiscalSnapshot = { issuer: issuerSnapshot(issuer), establishment: series.establishment, emissionPoint: series.emissionPoint, establishmentAddress: series.address,
      buyer: { name: order.wholesaler?.businessName ?? order.finalCustomer?.fullName ?? "", identification, identificationType: identification.length === 13 ? "04" : "05", address: buyer?.address ?? "", email: buyer?.email },
      lines: order.items.map(i => ({ itemId: i.id, code: i.variant.sku, description: i.variant.product.name, quantity: i.quantity, unitPrice: "0", ivaRate: "0", ivaCode: "0" })), paymentCode: "", creditDays: 0,
      transport: { ...input, startDate: fiscalDate(new Date(`${input.startDate}T12:00:00-05:00`)), endDate: fiscalDate(new Date(`${input.endDate}T12:00:00-05:00`)) } };
    return tx.fiscalDocument.create({ data: { issuerId: issuer.id, seriesId: series.id, dispatchOrderId: order.id, sourceKey: `guide:${order.id}`, documentType: "06", environment, issueDate: new Date(), buyerName: snapshot.buyer.name, buyerIdentification: identification, recipientEmail: buyer?.email, total: 0, snapshot: snapshot as unknown as Prisma.InputJsonValue, events: { create: { action: "DRAFT", message: "Guía preparada antes del traslado", performedById: req.user!.id } } } });
  }));
}));
fiscalDocumentsRouter.get("/:id", asyncHandler(async (req, res) => {
  const { unsignedXml: _u, signedXml: _s, authorizedXml: _a, ...doc } = await getFiscalDocument(req.params.id);
  const buyer = (doc.snapshot as unknown as FiscalSnapshot).buyer;
  const check = doc.documentType === "06" ? {} : checkIdentification(buyer.identificationType, buyer.identification);
  res.json({ ...doc, buyerWarning: check.error ?? check.warning ?? null });
}));
fiscalDocumentsRouter.patch("/:id/buyer", asyncHandler(async (req, res) => {
  const buyer = z.object({ name: short, identification: z.string().trim().min(3).max(20), identificationType: z.enum(["04", "05", "06"]), address: short, email: z.union([z.string().email(), z.literal("")]) }).strict().parse(req.body);
  const identification = checkIdentification(buyer.identificationType, buyer.identification);
  if (identification.error) throw badRequest(identification.error);
  res.json(await prisma.$transaction(async tx => {
    const claim = await tx.fiscalDocument.updateMany({ where: { id: req.params.id, status: "DRAFT", documentType: { in: ["01", "06"] } }, data: { updatedAt: new Date() } });
    if (!claim.count) throw conflict("Solo se pueden editar datos del comprador antes de emitir.");
    const doc = await tx.fiscalDocument.findUniqueOrThrow({ where: { id: req.params.id } });
    const snapshot = doc.snapshot as unknown as FiscalSnapshot; snapshot.buyer = buyer;
    return tx.fiscalDocument.update({ where: { id: doc.id }, data: { snapshot: snapshot as unknown as Prisma.InputJsonValue, buyerName: buyer.name, buyerIdentification: buyer.identification, recipientEmail: buyer.email || null, events: { create: { action: "EDIT_BUYER", message: "Datos del comprador revisados", performedById: req.user!.id } } } });
  }));
}));
fiscalDocumentsRouter.patch("/:id/transport", asyncHandler(async (req, res) => {
  const dates = z.object({ startDate: z.string().date(), endDate: z.string().date() }).strict().refine(d => d.endDate >= d.startDate, "La fecha final debe ser posterior a la inicial").parse(req.body);
  res.json(await prisma.$transaction(async tx => {
    const claim = await tx.fiscalDocument.updateMany({ where: { id: req.params.id, status: "DRAFT", documentType: "06" }, data: { updatedAt: new Date() } });
    if (!claim.count) throw conflict("Solo se pueden editar las fechas de una guía antes de emitirla.");
    const doc = await tx.fiscalDocument.findUniqueOrThrow({ where: { id: req.params.id } });
    const snapshot = doc.snapshot as unknown as FiscalSnapshot;
    snapshot.transport = { ...snapshot.transport!, startDate: fiscalDate(new Date(`${dates.startDate}T12:00:00-05:00`)), endDate: fiscalDate(new Date(`${dates.endDate}T12:00:00-05:00`)) };
    return tx.fiscalDocument.update({ where: { id: doc.id }, data: { snapshot: snapshot as unknown as Prisma.InputJsonValue, events: { create: { action: "EDIT_TRANSPORT", message: `Fechas del traslado actualizadas: ${snapshot.transport.startDate} a ${snapshot.transport.endDate}`, performedById: req.user!.id } } } });
  }));
}));
fiscalDocumentsRouter.post("/:id/issue", asyncHandler(async (req, res) => { const data = z.object({ paymentCode: z.string().max(2).default("") }).strict().parse(req.body); res.json(await prepareIssue(req.params.id, data.paymentCode, req.user!.id)); }));
fiscalDocumentsRouter.post("/:id/retry", asyncHandler(async (req, res) => { await processFiscalDocument(req.params.id); res.json(await getFiscalDocument(req.params.id)); }));
fiscalDocumentsRouter.post("/:id/correct-rejected", asyncHandler(async (req, res) => {
  const doc = await getFiscalDocument(req.params.id);
  if (doc.status !== "REJECTED" || !doc.accessKey) throw conflict("Solo puede corregirse un documento devuelto o no autorizado.");
  const result = await callSri(doc.environment, "authorization", doc.accessKey);
  if (result.state === "AUTHORIZED" || result.state === "RECEIVED") throw conflict("El SRI ya tiene el documento autorizado o en proceso. No se puede editar.");
  // Error 45: the sequential already exists in the SRI (issued outside this series). Returned documents are not
  // stored by the SRI, so this key was never registered: release it and assign a new number on the next issue.
  const sequenceTaken = /(^|;\s*)45:/.test(doc.lastMessage ?? "");
  await prisma.$transaction(async tx => {
    const claimed = await tx.fiscalDocument.updateMany({ where: { id: doc.id, status: "REJECTED" }, data: { status: "DRAFT", signedXml: null, unsignedXml: null, nextAttemptAt: null, ...(sequenceTaken ? { number: null, accessKey: null } : {}) } });
    if (!claimed.count) throw conflict("El documento cambió de estado.");
    await tx.fiscalEvent.create({ data: { documentId: doc.id, action: sequenceTaken ? "SEQUENCE_REGISTERED" : "CORRECT_REJECTED", performedById: req.user!.id,
      message: sequenceTaken ? `El SRI ya tenía registrado el secuencial ${doc.number}. Se asignará un número nuevo al emitir; avanza la numeración de la serie si hay más comprobantes emitidos fuera de la aplicación.` : "Corrección de documento no autorizado; se conserva número y clave." } });
  });
  res.json({ ok: true });
}));
fiscalDocumentsRouter.post("/:id/credit-note", asyncHandler(async (req, res) => {
  const data = z.object({ reason: short, lines: z.array(z.object({ itemId: z.string(), quantity: z.number().int().positive() }).strict()).min(1).max(500) }).strict().parse(req.body);
  res.status(201).json(await createCreditNote(req.params.id, data.lines, data.reason, req.user!.id));
}));
fiscalDocumentsRouter.post("/:id/void-draft", asyncHandler(async (req, res) => {
  await prisma.$transaction(async tx => {
    const result = await tx.fiscalDocument.updateMany({ where: { id: req.params.id, status: "DRAFT", documentType: "04", accessKey: null }, data: { status: "VOID" } });
    if (!result.count) throw conflict("Solo puede descartarse una nota en borrador que nunca se emitió.");
    await tx.fiscalEvent.create({ data: { documentId: req.params.id, action: "VOID", message: "Borrador descartado; no es una anulación SRI.", performedById: req.user!.id } });
  });
  res.json({ ok: true });
}));
fiscalDocumentsRouter.post("/:id/cancellation", asyncHandler(async (req, res) => {
  const data = z.object({ status: z.enum(["REQUESTED", "CONFIRMED", "REJECTED"]), evidence: z.string().trim().min(10).max(2000) }).strict().parse(req.body);
  res.json(await prisma.$transaction(async tx => {
    const doc = await tx.fiscalDocument.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
    if (doc.status !== "AUTHORIZED" || doc.buyerIdentification === "9999999999999" || doc.cancellationStatus === "CONFIRMED") throw conflict("Este comprobante no admite registrar ese trámite.");
    if (data.status !== "REQUESTED" && doc.cancellationStatus !== "REQUESTED") throw conflict("Primero registra la solicitud realizada en el portal del SRI.");
    const updated = await tx.fiscalDocument.update({ where: { id: doc.id }, data: { cancellationStatus: data.status, events: { create: { action: `PORTAL_CANCELLATION_${data.status}`, message: data.evidence, performedById: req.user!.id } } } });
    if (doc.dispatchOrderId && data.status === "CONFIRMED") await reconcileFiscalCredits(tx, doc.dispatchOrderId);
    return updated;
  }));
}));
fiscalDocumentsRouter.get("/:id/xml", asyncHandler(async (req, res) => {
  const doc = await getFiscalDocument(req.params.id);
  if (!doc.authorizedXml) throw conflict("El XML autorizado todavía no está disponible.");
  res.type("application/xml").attachment(`${doc.number}.xml`).send(doc.authorizedXml);
}));
fiscalDocumentsRouter.get("/:id/pdf", asyncHandler(async (req, res) => {
  const doc = await getFiscalDocument(req.params.id);
  res.type("application/pdf").attachment(`${doc.number ?? "borrador"}.pdf`).send(await renderFiscalPdf(doc));
}));
fiscalDocumentsRouter.post("/:id/email", asyncHandler(async (req, res) => {
  const { recipient } = z.object({ recipient: z.string().email().max(254) }).strict().parse(req.body);
  const doc = await getFiscalDocument(req.params.id);
  if (doc.status !== "AUTHORIZED" || !doc.authorizedXml) throw conflict("Solo se envían comprobantes autorizados.");
  const issuer = await prisma.fiscalIssuer.findUniqueOrThrow({ where: { id: doc.issuerId } });
  if (!issuer.mailProfileId) throw conflict("Configura el correo del emisor original.");
  await sendConfiguredMail(issuer.mailProfileId, { to: recipient, subject: `Comprobante ${doc.number} — ${(doc.snapshot as unknown as FiscalSnapshot).issuer.legalName}`, text: `Adjuntamos su comprobante electrónico ${doc.number}.`, attachments: [ { filename: `${doc.number}.xml`, content: Buffer.from(doc.authorizedXml), contentType: "application/xml" }, { filename: `${doc.number}.pdf`, content: await renderFiscalPdf(doc), contentType: "application/pdf" } ] }, doc.id);
  res.json({ ok: true });
}));
