import { Request, Response } from "express";
import { createProductSchema, listProductsQuerySchema, updateProductSchema } from "./products.schemas";
import {
  createProduct,
  getProductById,
  listProducts,
  softDeleteProduct,
  updateProduct,
} from "./products.service";

export async function listProductsController(req: Request, res: Response) {
  const query = listProductsQuerySchema.parse(req.query);
  res.json(await listProducts(query));
}

export async function getProductController(req: Request, res: Response) {
  res.json(await getProductById(req.params.id, req.user!.role));
}

export async function createProductController(req: Request, res: Response) {
  const data = createProductSchema.parse(req.body);
  res.status(201).json(await createProduct(data, req.user!.id));
}

export async function updateProductController(req: Request, res: Response) {
  const data = updateProductSchema.parse(req.body);
  res.json(await updateProduct(req.params.id, data, req.user!.id));
}

export async function deleteProductController(req: Request, res: Response) {
  await softDeleteProduct(req.params.id);
  res.status(204).send();
}
