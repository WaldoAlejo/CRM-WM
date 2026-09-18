import { Role } from "@prisma/client";
import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { forbidFieldsForRole } from "../../middleware/fieldPermissions";
import { imagesForVariantRouter } from "../images/images.routes";
import { PRICING_FIELDS } from "./pricingFields";
import {
  createVariantController,
  deleteVariantController,
  updateVariantController,
} from "./variants.controller";

// Anidado bajo /products/:productId/variants (solo crear).
export const variantsForProductRouter = Router({ mergeParams: true });
variantsForProductRouter.use(requireAuth);
variantsForProductRouter.post(
  "/",
  forbidFieldsForRole(PRICING_FIELDS, Role.OPERATOR),
  asyncHandler(createVariantController)
);

// Acceso directo por id, para editar/eliminar/subir imágenes sin repetir la
// ruta del producto padre.
export const variantsRouter = Router();
variantsRouter.use(requireAuth);
variantsRouter.patch(
  "/:id",
  forbidFieldsForRole(PRICING_FIELDS, Role.OPERATOR),
  asyncHandler(updateVariantController)
);
variantsRouter.delete("/:id", asyncHandler(deleteVariantController));
variantsRouter.use("/:variantId/images", imagesForVariantRouter);
