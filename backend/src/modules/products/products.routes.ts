import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { imagesForProductRouter } from "../images/images.routes";
import { variantsForProductRouter } from "../variants/variants.routes";
import {
  createProductController,
  deleteProductController,
  getProductController,
  listProductsController,
  updateProductController,
} from "./products.controller";

export const productsRouter = Router();

productsRouter.use(requireAuth);

// Administrar el catálogo de productos es trabajo operativo del día a día
// (llega mercadería nueva, hay que darla de alta), así que admin y operador
// pueden crear/editar/eliminar. La única restricción por rol es a nivel de
// campo (precios de variante), no de endpoint completo.
productsRouter.get("/", asyncHandler(listProductsController));
productsRouter.get("/:id", asyncHandler(getProductController));
productsRouter.post("/", asyncHandler(createProductController));
productsRouter.patch("/:id", asyncHandler(updateProductController));
productsRouter.delete("/:id", asyncHandler(deleteProductController));

productsRouter.use("/:productId/variants", variantsForProductRouter);
productsRouter.use("/:productId/images", imagesForProductRouter);
