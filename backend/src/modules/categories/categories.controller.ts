import { Request, Response } from "express";
import { createCategorySchema, updateCategorySchema } from "./categories.schemas";
import {
  createCategory,
  getCategoryById,
  listCategories,
  softDeleteCategory,
  updateCategory,
} from "./categories.service";

export async function listCategoriesController(_req: Request, res: Response) {
  res.json(await listCategories());
}

export async function getCategoryController(req: Request, res: Response) {
  res.json(await getCategoryById(req.params.id));
}

export async function createCategoryController(req: Request, res: Response) {
  const data = createCategorySchema.parse(req.body);
  res.status(201).json(await createCategory(data));
}

export async function updateCategoryController(req: Request, res: Response) {
  const data = updateCategorySchema.parse(req.body);
  res.json(await updateCategory(req.params.id, data));
}

export async function deleteCategoryController(req: Request, res: Response) {
  await softDeleteCategory(req.params.id);
  res.status(204).send();
}
