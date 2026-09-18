import { Request, Response } from "express";
import { createSubcategorySchema, updateSubcategorySchema } from "./subcategories.schemas";
import {
  createSubcategory,
  listSubcategoriesByCategory,
  softDeleteSubcategory,
  updateSubcategory,
} from "./subcategories.service";

export async function listSubcategoriesController(req: Request, res: Response) {
  res.json(await listSubcategoriesByCategory(req.params.categoryId));
}

export async function createSubcategoryController(req: Request, res: Response) {
  const data = createSubcategorySchema.parse(req.body);
  res.status(201).json(await createSubcategory(req.params.categoryId, data));
}

export async function updateSubcategoryController(req: Request, res: Response) {
  const data = updateSubcategorySchema.parse(req.body);
  res.json(await updateSubcategory(req.params.id, data));
}

export async function deleteSubcategoryController(req: Request, res: Response) {
  await softDeleteSubcategory(req.params.id);
  res.status(204).send();
}
