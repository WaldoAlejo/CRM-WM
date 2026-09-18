import { Request, Response } from "express";
import {
  accountsReceivableQuerySchema,
  confirmDispatchOrderSchema,
  createDispatchOrderSchema,
  createPaymentSchema,
  listDispatchOrdersQuerySchema,
} from "./dispatchOrders.schemas";
import {
  addPayment,
  cancelDispatchOrder,
  confirmDispatchOrder,
  createDispatchOrder,
  getAccountsReceivable,
  getDispatchOrderById,
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

export async function addPaymentController(req: Request, res: Response) {
  const data = createPaymentSchema.parse(req.body);
  res.status(201).json(await addPayment(req.params.id, data, req.user!.id));
}

export async function getAccountsReceivableController(req: Request, res: Response) {
  const query = accountsReceivableQuerySchema.parse(req.query);
  res.json(await getAccountsReceivable(query));
}
