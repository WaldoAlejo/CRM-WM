import { Request, Response } from "express";
import { createVariantSchema, updateVariantSchema } from "./variants.schemas";
import { createVariant, softDeleteVariant, updateVariant } from "./variants.service";

export async function createVariantController(req: Request, res: Response) {
  const data = createVariantSchema.parse(req.body);
  const variant = await createVariant(req.params.productId, data, req.user!.role);
  res.status(201).json(variant);
}

export async function updateVariantController(req: Request, res: Response) {
  const data = updateVariantSchema.parse(req.body);
  const variant = await updateVariant(req.params.id, data, req.user!.role);
  res.json(variant);
}

export async function deleteVariantController(req: Request, res: Response) {
  await softDeleteVariant(req.params.id);
  res.status(204).send();
}
