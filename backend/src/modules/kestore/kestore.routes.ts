import express, { Router, type NextFunction, type Request, type Response } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { findKestoreVariants, toCatalogItem } from "./kestore.catalog";
import { isValidKestoreSignature, KESTORE_SIGNATURE_HEADER, KESTORE_TIMESTAMP_HEADER, kestoreSecret } from "./kestore.config";
import { cancelKestoreOrder, getKestoreOrder, kestoreOrderSchema, receiveKestoreOrder } from "./kestore.orders";

// Rutas que llama el servidor de Kestore (sin sesión de usuario). Se montan
// ANTES de express.json(): la firma se verifica sobre el cuerpo crudo, tal
// cual llegó, y recién después se interpreta el JSON.
export const kestoreRouter = Router();

kestoreRouter.use(express.raw({ type: () => true, limit: "1mb" }));

function requireKestoreSignature(req: Request, _res: Response, next: NextFunction) {
  const secret = kestoreSecret();
  if (!secret) return next(new HttpError(503, "Integración con Kestore no habilitada."));
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  if (!isValidKestoreSignature(secret, req.header(KESTORE_TIMESTAMP_HEADER), req.header(KESTORE_SIGNATURE_HEADER), body)) {
    return next(new HttpError(401, "Firma o marca de tiempo inválida."));
  }
  req.body = body;
  next();
}

function parseJson(body: Buffer) {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "El cuerpo no es un JSON válido.");
  }
}

kestoreRouter.use(requireKestoreSignature);

kestoreRouter.get("/catalog", asyncHandler(async (req, res) => {
  // Railway termina el HTTPS en su proxy: el protocolo original llega en X-Forwarded-Proto.
  const protocol = req.get("x-forwarded-proto")?.split(",")[0].trim() || req.protocol;
  const baseUrl = process.env.PUBLIC_API_URL?.trim() || `${protocol}://${req.get("host")}`;
  const items = (await findKestoreVariants()).filter((v) => v.kestoreCode).map((v) => toCatalogItem(v, baseUrl));
  res.json({ ok: true, generadoEn: new Date().toISOString(), items });
}));

kestoreRouter.post("/orders", asyncHandler(async (req, res) => {
  const input = kestoreOrderSchema.parse(parseJson(req.body));
  const result = await receiveKestoreOrder(req.body, input);
  res.status(result.created ? 201 : 200).json(result.body);
}));

kestoreRouter.get("/orders/:orderNumber", asyncHandler(async (req, res) => {
  res.json(await getKestoreOrder(req.params.orderNumber));
}));

kestoreRouter.post("/orders/:orderNumber/cancel", asyncHandler(async (req, res) => {
  res.json(await cancelKestoreOrder(req.params.orderNumber));
}));
