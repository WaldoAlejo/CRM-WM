import { Router } from "express";
import multer from "multer";
import { Role } from "@prisma/client";
import { z } from "zod";
import { requireAuth, requireRole } from "../../middleware/auth";
import { asyncHandler } from "../../middleware/asyncHandler";
import { prisma } from "../../lib/prisma";
import { badRequest } from "../../utils/httpError";
import { issuerSchema, mailSchema, seriesSchema } from "./settings.schemas";
import { activateIssuer, addSeries, advanceSeries, audit, getSettings, replaceCertificate, saveIssuer, saveMail } from "./settings.service";
import { sendConfiguredMail, verifyMail } from "./mail.service";

export const fiscalSettingsRouter = Router();
fiscalSettingsRouter.use(requireAuth, requireRole(Role.ADMIN));
fiscalSettingsRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
fiscalSettingsRouter.get("/", asyncHandler(async (_req, res) => { res.json(await getSettings()); }));
fiscalSettingsRouter.post("/mail", asyncHandler(async (req, res) => { res.status(201).json(await saveMail(undefined, mailSchema.parse(req.body), req.user!.id)); }));
fiscalSettingsRouter.put("/mail/:id", asyncHandler(async (req, res) => { res.json(await saveMail(req.params.id, mailSchema.parse(req.body), req.user!.id)); }));
fiscalSettingsRouter.post("/mail/:id/verify", asyncHandler(async (req, res) => { res.json(await verifyMail(req.params.id)); }));
fiscalSettingsRouter.post("/mail/:id/test", asyncHandler(async (req, res) => {
  const { recipient } = z.object({ recipient: z.string().email().max(254) }).strict().parse(req.body);
  await sendConfiguredMail(req.params.id, { to: recipient, subject: "Prueba de configuración de correo", text: "La configuración de correo de la aplicación funciona correctamente." });
  res.json({ ok: true });
}));
fiscalSettingsRouter.post("/mail/:id/default", asyncHandler(async (req, res) => {
  await prisma.mailProfile.findUniqueOrThrow({ where: { id: req.params.id } });
  await prisma.$transaction(async tx => {
    await tx.fiscalSettings.upsert({ where: { id: 1 }, create: { id: 1, defaultMailProfileId: req.params.id }, update: { defaultMailProfileId: req.params.id } });
    await audit(tx, "MailProfile", req.params.id, "DEFAULT", req.user!.id);
  });
  res.json({ ok: true });
}));
fiscalSettingsRouter.get("/mail/deliveries", asyncHandler(async (_req, res) => { res.json(await prisma.mailDelivery.findMany({ take: 100, orderBy: { createdAt: "desc" } })); }));
fiscalSettingsRouter.post("/issuers", asyncHandler(async (req, res) => { res.status(201).json(await saveIssuer(undefined, issuerSchema.parse(req.body), req.user!.id)); }));
fiscalSettingsRouter.put("/issuers/:id", asyncHandler(async (req, res) => { res.json(await saveIssuer(req.params.id, issuerSchema.parse(req.body), req.user!.id)); }));
fiscalSettingsRouter.post("/issuers/:id/series", asyncHandler(async (req, res) => { res.status(201).json(await addSeries(req.params.id, seriesSchema.parse(req.body), req.user!.id)); }));
fiscalSettingsRouter.post("/issuers/:id/series/:seriesId/advance", asyncHandler(async (req, res) => {
  const { lastNumber } = z.object({ lastNumber: z.number().int().min(1).max(999999998) }).strict().parse(req.body);
  res.json(await advanceSeries(req.params.id, req.params.seriesId, lastNumber, req.user!.id));
}));
fiscalSettingsRouter.post("/issuers/:id/activate", asyncHandler(async (req, res) => {
  const { verified } = z.object({ verified: z.literal(true) }).strict().parse(req.body);
  res.json(await activateIssuer(req.params.id, verified, req.user!.id));
}));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1024 * 1024, files: 1, fields: 2 } });
fiscalSettingsRouter.post("/issuers/:id/certificate", upload.single("certificate"), asyncHandler(async (req, res) => {
  if (!req.file || !/\.(p12|pfx)$/i.test(req.file.originalname)) throw badRequest("Selecciona un archivo P12 o PFX de hasta 1 MB.");
  const { password, confirmedRepresentative } = z.object({ password: z.string().max(2000), confirmedRepresentative: z.literal("true") }).strict().parse(req.body);
  try { res.status(201).json(await replaceCertificate(req.params.id, req.file.buffer, password, confirmedRepresentative === "true", req.user!.id)); }
  finally { req.file.buffer.fill(0); }
}));
