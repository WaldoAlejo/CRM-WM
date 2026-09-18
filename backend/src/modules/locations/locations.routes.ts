import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth, requireRole } from "../../middleware/auth";
import {
  createLocationController,
  deleteLocationController,
  listLocationsController,
  updateLocationController,
} from "./locations.controller";

// Anidado bajo /warehouses/:warehouseId/locations (listar y crear), mismo
// patrón que nestedSubcategoriesRouter.
export const nestedLocationsRouter = Router({ mergeParams: true });
nestedLocationsRouter.use(requireAuth);
nestedLocationsRouter.get("/", asyncHandler(listLocationsController));
nestedLocationsRouter.post("/", requireRole(Role.ADMIN), asyncHandler(createLocationController));

// Acceso directo por id, para editar/eliminar sin repetir la ruta del padre.
export const locationsRouter = Router();
locationsRouter.use(requireAuth);
locationsRouter.patch("/:id", requireRole(Role.ADMIN), asyncHandler(updateLocationController));
locationsRouter.delete("/:id", requireRole(Role.ADMIN), asyncHandler(deleteLocationController));
