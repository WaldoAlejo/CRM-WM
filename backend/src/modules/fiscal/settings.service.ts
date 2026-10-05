import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { badRequest, conflict, notFound } from "../../utils/httpError";
import { encryptSecret, encryptionReady } from "./secrets";
import { readCertificate } from "./certificates";
import { issuerSchema, mailSchema, seriesSchema } from "./settings.schemas";

export const certificateSelect = { id: true, subject: true, issuedBy: true, serialNumber: true, fingerprint: true, validFrom: true, validTo: true, retiredAt: true, createdAt: true } as const;
export function publicMail<T extends { passwordEncrypted: string | null }>(row: T) {
  const { passwordEncrypted, ...rest } = row;
  return { ...rest, hasPassword: Boolean(passwordEncrypted) };
}
export async function audit(tx: Prisma.TransactionClient, entityType: string, entityId: string, action: string, userId?: string) {
  await tx.auditLog.create({ data: { entityType, entityId, action: "UPDATE", changes: { action }, performedById: userId } });
}
export async function getSettings() {
  const [settings, mailProfiles, issuers] = await Promise.all([
    prisma.fiscalSettings.findUnique({ where: { id: 1 } }), prisma.mailProfile.findMany({ orderBy: { createdAt: "asc" } }),
    prisma.fiscalIssuer.findMany({ orderBy: { createdAt: "asc" }, include: { series: true, certificates: { select: certificateSelect, orderBy: { createdAt: "desc" } } } }),
  ]);
  return { settings, mailProfiles: mailProfiles.map(publicMail), issuers, encryptionReady: encryptionReady(), productionEnabled: process.env.FISCAL_PRODUCTION_ENABLED === "true" };
}
export async function saveMail(id: string | undefined, input: z.infer<typeof mailSchema>, userId?: string) {
  const { password, clearPassword, ...rest } = input;
  // Resend envía por API HTTPS (Railway bloquea SMTP saliente en planes sin Pro):
  // la contraseña guardada es la API key y no hay servidor ni usuario SMTP.
  const data = rest.security === "RESEND" ? { ...rest, host: "api.resend.com", port: 443, username: "" } : rest;
  const profileId = id ?? randomUUID();
  const existing = id ? await prisma.mailProfile.findUnique({ where: { id } }) : null;
  if (id && !existing) throw notFound();
  const passwordEncrypted = clearPassword ? null : password ? encryptSecret(password, `mail:${profileId}`) : existing?.passwordEncrypted ?? null;
  if (data.username && !passwordEncrypted) throw badRequest("Indica una contraseña para el usuario SMTP.");
  if (data.security === "RESEND" && !passwordEncrypted) throw badRequest("Indica la API key de Resend.");
  return prisma.$transaction(async tx => {
    const row = await tx.mailProfile.upsert({ where: { id: profileId }, create: { id: profileId, ...data, passwordEncrypted }, update: { ...data, passwordEncrypted } });
    await audit(tx, "MailProfile", row.id, existing ? "EDIT" : "CREATE", userId);
    return publicMail(row);
  });
}
export async function saveIssuer(id: string | undefined, data: z.infer<typeof issuerSchema>, userId?: string) {
  return prisma.$transaction(async tx => {
    if (id) {
      const old = await tx.fiscalIssuer.findUnique({ where: { id } });
      if (!old) throw notFound();
      if (old.ruc !== data.ruc) throw conflict("Para otro RUC registra una empresa nueva. El RUC de una empresa existente no se reemplaza.");
    }
    const row = id ? await tx.fiscalIssuer.update({ where: { id }, data: { ...data, enabledForEmission: false, verifiedAt: null } }) : await tx.fiscalIssuer.create({ data });
    await audit(tx, "FiscalIssuer", row.id, id ? "EDIT_REQUIRES_VALIDATION" : "CREATE", userId);
    return row;
  });
}
export async function replaceCertificate(issuerId: string, bytes: Buffer, password: string, confirmedRepresentative: boolean, userId?: string) {
  if (!confirmedRepresentative) throw badRequest("Confirma que el titular de la firma está habilitado para representar a esta empresa.");
  if (!await prisma.fiscalIssuer.findUnique({ where: { id: issuerId } })) throw notFound();
  const parsed = readCertificate(bytes, password);
  const { privateKeyPem: _key, certificateBase64: _cert, ...metadata } = parsed;
  const id = randomUUID();
  const p12Encrypted = encryptSecret(bytes.toString("base64"), `p12:${id}`);
  const passwordEncrypted = encryptSecret(password, `p12-password:${id}`);
  return prisma.$transaction(async tx => {
    // Updating the parent serializes simultaneous replacements.
    await tx.fiscalIssuer.update({ where: { id: issuerId }, data: { updatedAt: new Date() } });
    await tx.fiscalCertificate.updateMany({ where: { issuerId, retiredAt: null }, data: { retiredAt: new Date(), p12Encrypted: null, passwordEncrypted: null } });
    const certificate = await tx.fiscalCertificate.create({ data: { id, issuerId, p12Encrypted, passwordEncrypted, ...metadata }, select: certificateSelect });
    await audit(tx, "FiscalCertificate", id, "REPLACE_CONFIRMED_REPRESENTATIVE", userId);
    return certificate;
  });
}
export async function addSeries(issuerId: string, data: z.infer<typeof seriesSchema>, userId?: string) {
  return prisma.$transaction(async tx => {
    const row = await tx.fiscalSeries.create({ data: { issuerId, ...data } });
    await audit(tx, "FiscalSeries", row.id, "CREATE_INITIAL_SEQUENCE", userId);
    return row;
  });
}
// Numbering only moves forward: used when documents were issued outside the application (SRI error 45).
export async function advanceSeries(issuerId: string, seriesId: string, lastNumber: number, userId?: string) {
  return prisma.$transaction(async tx => {
    const updated = await tx.fiscalSeries.updateMany({ where: { id: seriesId, issuerId, lastNumber: { lt: lastNumber } }, data: { lastNumber } });
    if (!updated.count) throw conflict("La numeración solo puede avanzar a un número mayor que el último asignado.");
    await audit(tx, "FiscalSeries", seriesId, `ADVANCE_TO_${lastNumber}`, userId);
    return tx.fiscalSeries.findUniqueOrThrow({ where: { id: seriesId } });
  });
}
export async function activateIssuer(id: string, verified: boolean, userId?: string) {
  if (!verified) throw badRequest("Confirma que verificaste los datos fiscales y la habilitación del emisor en el SRI.");
  return prisma.$transaction(async tx => {
    const issuer = await tx.fiscalIssuer.findUnique({ where: { id }, include: { certificates: { where: { retiredAt: null } }, series: true } });
    if (!issuer) throw notFound();
    if (issuer.regime === "RIMPE_POPULAR") throw conflict("RIMPE negocio popular no es compatible con los esquemas XSD vigentes del SRI. Actualiza el régimen del emisor.");
    if (issuer.environment === "2" && process.env.FISCAL_PRODUCTION_ENABLED !== "true") throw conflict("Producción no está habilitada en el servidor. Completa primero las pruebas con el SRI.");
    const certificate = issuer.certificates[0];
    if (!certificate || certificate.validTo <= new Date() || certificate.validFrom > new Date()) throw conflict("Carga una firma vigente antes de activar la empresa.");
    if (!["01", "04", "06"].every(type => issuer.series.some(s => s.documentType === type && s.environment === issuer.environment))) throw conflict("Configura series de factura, nota de crédito y guía para este ambiente.");
    await tx.fiscalIssuer.update({ where: { id }, data: { verifiedAt: new Date(), enabledForEmission: true } });
    await tx.fiscalSettings.upsert({ where: { id: 1 }, create: { id: 1, activeIssuerId: id }, update: { activeIssuerId: id } });
    await audit(tx, "FiscalIssuer", id, "ACTIVATE", userId);
    return { activeIssuerId: id };
  });
}
