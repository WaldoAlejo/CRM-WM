import { Request, Response } from "express";
import { buildPublicUrl } from "../../lib/upload";
import { badRequest } from "../../utils/httpError";
import { addProductImage, addVariantImage, deleteImage } from "./images.service";

export async function addProductImageController(req: Request, res: Response) {
  if (!req.file) throw badRequest("Debes adjuntar un archivo de imagen (campo 'image')");
  const url = buildPublicUrl("products", req.params.productId, req.file.filename);
  res.status(201).json(await addProductImage(req.params.productId, url));
}

export async function addVariantImageController(req: Request, res: Response) {
  if (!req.file) throw badRequest("Debes adjuntar un archivo de imagen (campo 'image')");
  const url = buildPublicUrl("variants", req.params.variantId, req.file.filename);
  res.status(201).json(await addVariantImage(req.params.variantId, url));
}

export async function deleteImageController(req: Request, res: Response) {
  await deleteImage(req.params.id);
  res.status(204).send();
}
