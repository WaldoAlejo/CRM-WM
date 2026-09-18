import { Router } from "express";
import { asyncHandler } from "../../middleware/asyncHandler";
import { loginController } from "./auth.controller";

export const authRouter = Router();

authRouter.post("/login", asyncHandler(loginController));
