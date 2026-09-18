import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import { nestedSubcategoriesRouter } from "../subcategories/subcategories.routes";
import {
  createCategoryController,
  deleteCategoryController,
  getCategoryController,
  listCategoriesController,
  updateCategoryController,
} from "./categories.controller";

export const categoriesRouter = Router();

categoriesRouter.use(requireAuth);
categoriesRouter.use("/:categoryId/subcategories", nestedSubcategoriesRouter);

// Consultar categorías: cualquier usuario autenticado (admin u operador).
categoriesRouter.get("/", asyncHandler(listCategoriesController));
categoriesRouter.get("/:id", asyncHandler(getCategoryController));

// Administrar el catálogo de categorías: solo admin.
categoriesRouter.post("/", requireRole(Role.ADMIN), asyncHandler(createCategoryController));
categoriesRouter.patch("/:id", requireRole(Role.ADMIN), asyncHandler(updateCategoryController));
categoriesRouter.delete("/:id", requireRole(Role.ADMIN), asyncHandler(deleteCategoryController));
