import { NextFunction, Request, Response } from "express";
import { discardUploadedFile, privateRelativePath, resolvePrivatePath } from "../../lib/upload";
import {
  accountsReceivableQuerySchema,
  confirmDispatchOrderSchema,
  createDispatchOrderSchema,
  createPaymentSchema,
  listDispatchOrdersQuerySchema,
} from "./dispatchOrders.schemas";
import {
  addPayment,
  assertOrderExists,
  cancelDispatchOrder,
  confirmDispatchOrder,
  createDispatchOrder,
  getAccountsReceivable,
  getDispatchOrderById,
  getPaymentProofPath,
  listDispatchOrders,
} from "./dispatchOrders.service";

export async function createDispatchOrderController(req: Request, res: Response) {
  const data = createDispatchOrderSchema.parse(req.body);
  res.status(201).json(await createDispatchOrder(data, req.user!.id, req.user!.role));
}

export async function confirmDispatchOrderController(req: Request, res: Response) {
  const data = confirmDispatchOrderSchema.parse(req.body);
  res.json(await confirmDispatchOrder(req.params.id, data, req.user!.id, req.user!.role));
}

export async function cancelDispatchOrderController(req: Request, res: Response) {
  res.json(await cancelDispatchOrder(req.params.id, req.user!.role));
}

export async function listDispatchOrdersController(req: Request, res: Response) {
  const query = listDispatchOrdersQuerySchema.parse(req.query);
  res.json(await listDispatchOrders(query));
}

export async function getDispatchOrderController(req: Request, res: Response) {
  res.json(await getDispatchOrderById(req.params.id, req.user!.role));
}

// Corre ANTES de multer: no se escribe ningún archivo en disco para una orden
// que no existe (multer crearía la carpeta con un id arbitrario de la URL).
export async function assertOrderExistsMiddleware(req: Request, _res: Response, next: NextFunction) {
  try {
    await assertOrderExists(req.params.id);
    next();
  } catch (err) {
    next(err);
  }
}

// multipart (con foto `proof`) o JSON (sin foto): mismo endpoint. Si el pago NO
// llega a registrarse (validación, error de BD) el archivo recién subido se
// descarta: no queda un comprobante huérfano sin pago.
export async function addPaymentController(req: Request, res: Response) {
  try {
    const data = createPaymentSchema.parse(req.body);
    const proofFile = req.file ? privateRelativePath(req.file) : undefined;
    res.status(201).json(await addPayment(req.params.id, { ...data, proofFile }, req.user!.id));
  } catch (err) {
    discardUploadedFile(req.file);
    throw err;
  }
}

export async function getPaymentProofController(req: Request, res: Response) {
  const relative = await getPaymentProofPath(req.params.id, req.params.paymentId);
  const file = resolvePrivatePath(relative);
  // Dato sensible (puede mostrar cuentas bancarias): nada de cache compartido,
  // y el navegador no debe "adivinar" otro tipo de contenido.
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(file, (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "El comprobante no está disponible" });
  });
}

// Los pagos son un ledger append-only: no se editan ni se borran, tampoco su
// comprobante. Una corrección se hace con un pago nuevo (p. ej. monto negativo).
export function immutablePaymentController(_req: Request, res: Response) {
  res
    .status(405)
    .set("Allow", "GET")
    .json({ error: "Los pagos no se pueden editar ni eliminar (ledger append-only). Registra un pago nuevo para corregir." });
}

export async function getAccountsReceivableController(req: Request, res: Response) {
  const query = accountsReceivableQuerySchema.parse(req.query);
  res.json(await getAccountsReceivable(query));
}
