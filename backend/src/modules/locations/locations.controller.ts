import { Request, Response } from "express";
import { createLocationSchema, updateLocationSchema } from "./locations.schemas";
import {
  createLocation,
  deactivateLocation,
  listLocationsByWarehouse,
  updateLocation,
} from "./locations.service";

export async function listLocationsController(req: Request, res: Response) {
  res.json(await listLocationsByWarehouse(req.params.warehouseId));
}

export async function createLocationController(req: Request, res: Response) {
  const data = createLocationSchema.parse(req.body);
  res.status(201).json(await createLocation(req.params.warehouseId, data));
}

export async function updateLocationController(req: Request, res: Response) {
  const data = updateLocationSchema.parse(req.body);
  res.json(await updateLocation(req.params.id, data));
}

export async function deleteLocationController(req: Request, res: Response) {
  await deactivateLocation(req.params.id);
  res.status(204).send();
}
