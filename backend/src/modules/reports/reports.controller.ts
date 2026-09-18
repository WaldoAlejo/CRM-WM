import { Request, Response } from "express";
import { profitabilityQuerySchema } from "./reports.schemas";
import { getProfitabilityReport, getProfitabilitySummary } from "./reports.service";

export async function getProfitabilityReportController(req: Request, res: Response) {
  const query = profitabilityQuerySchema.parse(req.query);
  res.json(await getProfitabilityReport(query));
}

export async function getProfitabilitySummaryController(req: Request, res: Response) {
  const query = profitabilityQuerySchema.parse(req.query);
  res.json(await getProfitabilitySummary(query));
}
