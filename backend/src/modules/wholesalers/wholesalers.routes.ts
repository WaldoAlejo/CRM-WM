import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createWholesalerController,
  deleteWholesalerController,
  listWholesalersController,
  updateWholesalerController,
  validateRucController,
} from "./wholesalers.controller";

export const wholesalersRouter = Router();

wholesalersRouter.use(requireAuth);

// Registrar/consultar mayoristas es una tarea operativa del día a día (no
// administración de catálogo), así que admin y operador pueden hacerlo.
wholesalersRouter.get("/", asyncHandler(listWholesalersController));
wholesalersRouter.post("/", asyncHandler(createWholesalerController));
wholesalersRouter.post("/validate-ruc", asyncHandler(validateRucController));

// Editar/eliminar sí quedan admin-only, mismo criterio que Suppliers/Brands.
wholesalersRouter.patch("/:id", requireRole(Role.ADMIN), asyncHandler(updateWholesalerController));
wholesalersRouter.delete("/:id", requireRole(Role.ADMIN), asyncHandler(deleteWholesalerController));
