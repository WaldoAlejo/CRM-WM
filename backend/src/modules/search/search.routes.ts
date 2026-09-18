import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { requireAuth } from "../../middleware/auth";
import { searchController } from "./search.controller";

export const searchRouter = Router();
searchRouter.use(requireAuth);
searchRouter.get("/", asyncHandler(searchController));
