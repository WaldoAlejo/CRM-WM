import { Request, Response } from "express";
import {
  createImportBatchSchema,
  listImportBatchesQuerySchema,
  receiveStockSchema,
} from "./importBatches.schemas";
import {
  createImportBatch,
  getImportBatchById,
  listImportBatches,
  receiveStock,
} from "./importBatches.service";

export async function listImportBatchesController(req: Request, res: Response) {
  const query = listImportBatchesQuerySchema.parse(req.query);
  res.json(await listImportBatches(query, req.user!.role));
}

export async function getImportBatchController(req: Request, res: Response) {
  res.json(await getImportBatchById(req.params.id, req.user!.role));
}

export async function createImportBatchController(req: Request, res: Response) {
  const data = createImportBatchSchema.parse(req.body);
  res.status(201).json(await createImportBatch(data, req.user!.id, req.user!.role));
}

export async function receiveStockController(req: Request, res: Response) {
  const { lines } = receiveStockSchema.parse(req.body);
  const idempotencyKey = req.header("Idempotency-Key") || undefined;
  const result = await receiveStock(
    req.params.id,
    lines,
    req.user!.id,
    req.user!.role,
    idempotencyKey
  );
  res.status(201).json(result);
}
