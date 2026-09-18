import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createBrandController,
  deleteBrandController,
  getBrandController,
  listBrandsController,
  updateBrandController,
} from "./brands.controller";

export const brandsRouter = Router();
brandsRouter.use(requireAuth);

// Consultar marcas: cualquier usuario autenticado.
brandsRouter.get("/", asyncHandler(listBrandsController));
brandsRouter.get("/:id", asyncHandler(getBrandController));

// Administrar el catálogo de marcas: solo admin.
brandsRouter.post("/", requireRole(Role.ADMIN), asyncHandler(createBrandController));
brandsRouter.patch("/:id", requireRole(Role.ADMIN), asyncHandler(updateBrandController));
brandsRouter.delete("/:id", requireRole(Role.ADMIN), asyncHandler(deleteBrandController));
