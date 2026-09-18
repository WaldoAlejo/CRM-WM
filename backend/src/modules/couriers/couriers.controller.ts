import { Request, Response } from "express";
import { createCourierSchema, listCouriersQuerySchema, updateCourierSchema } from "./couriers.schemas";
import { createCourier, deactivateCourier, getCourierById, listCouriers, updateCourier } from "./couriers.service";

export async function listCouriersController(req: Request, res: Response) {
  const query = listCouriersQuerySchema.parse(req.query);
  res.json(await listCouriers(query));
}

export async function getCourierController(req: Request, res: Response) {
  res.json(await getCourierById(req.params.id));
}

export async function createCourierController(req: Request, res: Response) {
  const data = createCourierSchema.parse(req.body);
  res.status(201).json(await createCourier(data));
}

export async function updateCourierController(req: Request, res: Response) {
  const data = updateCourierSchema.parse(req.body);
  res.json(await updateCourier(req.params.id, data));
}

export async function deleteCourierController(req: Request, res: Response) {
  await deactivateCourier(req.params.id);
  res.status(204).send();
}
