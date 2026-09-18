import { Request, Response } from "express";
import { createSupplierSchema, listSuppliersQuerySchema, updateSupplierSchema } from "./suppliers.schemas";
import { createSupplier, getSupplierById, listSuppliers, softDeleteSupplier, updateSupplier } from "./suppliers.service";

export async function listSuppliersController(req: Request, res: Response) {
  const query = listSuppliersQuerySchema.parse(req.query);
  res.json(await listSuppliers(query));
}

export async function getSupplierController(req: Request, res: Response) {
  res.json(await getSupplierById(req.params.id));
}

export async function createSupplierController(req: Request, res: Response) {
  const data = createSupplierSchema.parse(req.body);
  res.status(201).json(await createSupplier(data));
}

export async function updateSupplierController(req: Request, res: Response) {
  const data = updateSupplierSchema.parse(req.body);
  res.json(await updateSupplier(req.params.id, data));
}

export async function deleteSupplierController(req: Request, res: Response) {
  await softDeleteSupplier(req.params.id);
  res.status(204).send();
}
