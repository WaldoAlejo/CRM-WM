import { Request, Response } from "express";
import { createBrandSchema, listBrandsQuerySchema, updateBrandSchema } from "./brands.schemas";
import { createBrand, getBrandById, listBrands, softDeleteBrand, updateBrand } from "./brands.service";

export async function listBrandsController(req: Request, res: Response) {
  const query = listBrandsQuerySchema.parse(req.query);
  res.json(await listBrands(query));
}

export async function getBrandController(req: Request, res: Response) {
  res.json(await getBrandById(req.params.id));
}

export async function createBrandController(req: Request, res: Response) {
  const data = createBrandSchema.parse(req.body);
  res.status(201).json(await createBrand(data));
}

export async function updateBrandController(req: Request, res: Response) {
  const data = updateBrandSchema.parse(req.body);
  res.json(await updateBrand(req.params.id, data));
}

export async function deleteBrandController(req: Request, res: Response) {
  await softDeleteBrand(req.params.id);
  res.status(204).send();
}
