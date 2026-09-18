import { Request, Response } from "express";
import {
  createFinalCustomerSchema,
  listFinalCustomersQuerySchema,
  updateFinalCustomerSchema,
} from "./finalCustomers.schemas";
import {
  createFinalCustomer,
  getFinalCustomerById,
  listFinalCustomers,
  softDeleteFinalCustomer,
  updateFinalCustomer,
} from "./finalCustomers.service";

export async function listFinalCustomersController(req: Request, res: Response) {
  const query = listFinalCustomersQuerySchema.parse(req.query);
  res.json(await listFinalCustomers(query));
}

export async function getFinalCustomerController(req: Request, res: Response) {
  res.json(await getFinalCustomerById(req.params.id));
}

export async function createFinalCustomerController(req: Request, res: Response) {
  const data = createFinalCustomerSchema.parse(req.body);
  res.status(201).json(await createFinalCustomer(data));
}

export async function updateFinalCustomerController(req: Request, res: Response) {
  const data = updateFinalCustomerSchema.parse(req.body);
  res.json(await updateFinalCustomer(req.params.id, data));
}

export async function deleteFinalCustomerController(req: Request, res: Response) {
  await softDeleteFinalCustomer(req.params.id);
  res.status(204).send();
}
