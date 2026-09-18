import { Request, Response } from "express";
import {
  createAdjustmentSchema,
  listMovementsQuerySchema,
  stockSummaryQuerySchema,
} from "./inventory.schemas";
import { createAdjustment, getStockSummary, listMovements } from "./inventory.service";

export async function createAdjustmentController(req: Request, res: Response) {
  const data = createAdjustmentSchema.parse(req.body);
  const movement = await createAdjustment(data, req.user!.id, req.user!.role);
  res.status(201).json(movement);
}

export async function listMovementsController(req: Request, res: Response) {
  const query = listMovementsQuerySchema.parse(req.query);
  res.json(await listMovements(query, req.user!.role));
}

export async function getStockSummaryController(req: Request, res: Response) {
  const query = stockSummaryQuerySchema.parse(req.query);
  res.json(await getStockSummary(query));
}
