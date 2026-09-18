import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { uploadProductImage, uploadVariantImage } from "../../lib/upload";
import {
  addProductImageController,
  addVariantImageController,
  deleteImageController,
} from "./images.controller";

// Anidados bajo /products/:productId/images y /variants/:variantId/images.
export const imagesForProductRouter = Router({ mergeParams: true });
imagesForProductRouter.use(requireAuth);
imagesForProductRouter.post(
  "/",
  uploadProductImage.single("image"),
  asyncHandler(addProductImageController)
);

export const imagesForVariantRouter = Router({ mergeParams: true });
imagesForVariantRouter.use(requireAuth);
imagesForVariantRouter.post(
  "/",
  uploadVariantImage.single("image"),
  asyncHandler(addVariantImageController)
);

// Acceso directo por id para borrar (no se sabe si es imagen de producto o
// de variante hasta buscarla, ver images.service.ts).
export const imagesRouter = Router();
imagesRouter.use(requireAuth);
imagesRouter.delete("/:id", asyncHandler(deleteImageController));
