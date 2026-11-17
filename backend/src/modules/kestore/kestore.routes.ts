import { KestoreTarget } from "@prisma/client";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { HttpError } from "../../utils/httpError";
import { findKestoreVariants, toCatalogItem } from "./kestore.catalog";
import { isValidKestoreSignature, KESTORE_SIGNATURE_HEADER, KESTORE_TIMESTAMP_HEADER, kestoreDevSecret, kestoreSecret } from "./kestore.config";
import { cancelKestoreOrder, getKestoreOrder, kestoreOrderSchema, receiveKestoreOrder } from "./kestore.orders";

// Rutas que llama el servidor de Kestore (sin sesión de usuario). Se montan
// ANTES de express.json(): la firma se verifica sobre el cuerpo crudo, tal
// cual llegó, y recién después se interpreta el JSON.
export const kestoreRouter = Router();

kestoreRouter.use(express.raw({ type: () => true, limit: "1mb" }));

// El secreto con que viene firmada la petición dice qué Kestore llama:
// producción o kestore-dev (si tiene su propio secreto configurado).
function requireKestoreSignature(req: Request, res: Response, next: NextFunction) {
  const secret = kestoreSecret();
  if (!secret) return next(new HttpError(503, "Integración con Kestore no habilitada."));
  const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
  const timestamp = req.header(KESTORE_TIMESTAMP_HEADER);
  const signature = req.header(KESTORE_SIGNATURE_HEADER);
  const devSecret = kestoreDevSecret();
  if (isValidKestoreSignature(secret, timestamp, signature, body)) res.locals.kestoreTarget = KestoreTarget.PROD;
  else if (devSecret && isValidKestoreSignature(devSecret, timestamp, signature, body)) res.locals.kestoreTarget = KestoreTarget.DEV;
  else return next(new HttpError(401, "Firma o marca de tiempo inválida."));
  req.body = body;
  next();
}

// kestore-dev es para probar: nunca registra ni anula pedidos, que reservan stock real.
function rejectDevOrders(_req: Request, res: Response, next: NextFunction) {
  if (res.locals.kestoreTarget === KestoreTarget.DEV) return next(new HttpError(403, "kestore-dev no registra pedidos en el CRM."));
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
  const target = res.locals.kestoreTarget as KestoreTarget;
  const items = (await findKestoreVariants()).filter((v) => v.kestoreCode).map((v) => toCatalogItem(v, baseUrl, target));
  res.json({ ok: true, generadoEn: new Date().toISOString(), items });
}));

kestoreRouter.post("/orders", rejectDevOrders, asyncHandler(async (req, res) => {
  const input = kestoreOrderSchema.parse(parseJson(req.body));
  const result = await receiveKestoreOrder(req.body, input);
  res.status(result.created ? 201 : 200).json(result.body);
}));

kestoreRouter.get("/orders/:orderNumber", rejectDevOrders, asyncHandler(async (req, res) => {
  res.json(await getKestoreOrder(req.params.orderNumber));
}));

kestoreRouter.post("/orders/:orderNumber/cancel", rejectDevOrders, asyncHandler(async (req, res) => {
  res.json(await cancelKestoreOrder(req.params.orderNumber));
}));
