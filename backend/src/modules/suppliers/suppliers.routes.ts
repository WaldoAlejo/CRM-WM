import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createSupplierController,
  deleteSupplierController,
  getSupplierController,
  listSuppliersController,
  updateSupplierController,
} from "./suppliers.controller";

export const suppliersRouter = Router();
suppliersRouter.use(requireAuth);

// Consultar proveedores: cualquier usuario autenticado.
suppliersRouter.get("/", asyncHandler(listSuppliersController));
suppliersRouter.get("/:id", asyncHandler(getSupplierController));

// Administrar el catálogo de proveedores: solo admin.
suppliersRouter.post("/", requireRole(Role.ADMIN), asyncHandler(createSupplierController));
suppliersRouter.patch("/:id", requireRole(Role.ADMIN), asyncHandler(updateSupplierController));
suppliersRouter.delete("/:id", requireRole(Role.ADMIN), asyncHandler(deleteSupplierController));
