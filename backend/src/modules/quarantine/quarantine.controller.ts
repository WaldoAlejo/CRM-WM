import { Request, Response } from "express";
import { inspectionSchema, queueQuerySchema } from "./quarantine.schemas";
import { inspectReturnLine, listQuarantineQueue } from "./quarantine.service";

export async function listQueueController(req: Request, res: Response) {
  res.json(await listQuarantineQueue(queueQuerySchema.parse(req.query)));
}

export async function inspectController(req: Request, res: Response) {
  const data = inspectionSchema.parse(req.body);
  res.status(201).json(await inspectReturnLine(req.params.id, data, req.user?.id));
}
