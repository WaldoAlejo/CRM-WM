import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createSubcategoryController,
  deleteSubcategoryController,
  listSubcategoriesController,
  updateSubcategoryController,
} from "./subcategories.controller";

// Anidado bajo /categories/:categoryId/subcategories (listar y crear).
export const nestedSubcategoriesRouter = Router({ mergeParams: true });
nestedSubcategoriesRouter.use(requireAuth);
nestedSubcategoriesRouter.get("/", asyncHandler(listSubcategoriesController));
nestedSubcategoriesRouter.post(
  "/",
  requireRole(Role.ADMIN),
  asyncHandler(createSubcategoryController)
);

// Acceso directo por id, para editar/eliminar sin repetir la ruta del padre.
export const subcategoriesRouter = Router();
subcategoriesRouter.use(requireAuth);
subcategoriesRouter.patch(
  "/:id",
  requireRole(Role.ADMIN),
  asyncHandler(updateSubcategoryController)
);
subcategoriesRouter.delete(
  "/:id",
  requireRole(Role.ADMIN),
  asyncHandler(deleteSubcategoryController)
);
