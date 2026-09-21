import { Request, Response } from "express";
import { createLotSchema, createReviewSchema, listLotsQuerySchema } from "./consignment.schemas";
import { createLot, createReview, getLot, listLots, listOverdueReviews } from "./consignment.service";

export async function createLotController(req: Request, res: Response) {
  const data = createLotSchema.parse(req.body);
  res.status(201).json(await createLot(data, req.user?.id));
}

export async function listLotsController(req: Request, res: Response) {
  res.json(await listLots(listLotsQuerySchema.parse(req.query)));
}

export async function getLotController(req: Request, res: Response) {
  res.json(await getLot(req.params.id));
}

export async function createReviewController(req: Request, res: Response) {
  const data = createReviewSchema.parse(req.body);
  res.status(201).json(await createReview(req.params.id, data, req.user?.id));
}

export async function overdueReviewsController(_req: Request, res: Response) {
  res.json(await listOverdueReviews());
}
