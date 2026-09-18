import { Request, Response } from "express";
import { createWarehouseSchema, updateWarehouseSchema } from "./warehouses.schemas";
import {
  createWarehouse,
  deactivateWarehouse,
  getWarehouseById,
  listWarehouses,
  updateWarehouse,
} from "./warehouses.service";

export async function listWarehousesController(_req: Request, res: Response) {
  res.json(await listWarehouses());
}

export async function getWarehouseController(req: Request, res: Response) {
  res.json(await getWarehouseById(req.params.id));
}

export async function createWarehouseController(req: Request, res: Response) {
  const data = createWarehouseSchema.parse(req.body);
  res.status(201).json(await createWarehouse(data));
}

export async function updateWarehouseController(req: Request, res: Response) {
  const data = updateWarehouseSchema.parse(req.body);
  res.json(await updateWarehouse(req.params.id, data));
}

export async function deleteWarehouseController(req: Request, res: Response) {
  await deactivateWarehouse(req.params.id);
  res.status(204).send();
}
