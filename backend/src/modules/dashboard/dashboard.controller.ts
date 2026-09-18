import { Request, Response } from "express";
import { getDashboardSummary } from "./dashboard.service";

export async function getDashboardSummaryController(req: Request, res: Response) {
  res.json(await getDashboardSummary(req.user!.role));
}
