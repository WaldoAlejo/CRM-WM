import { Request, Response } from "express";
import { searchQuerySchema } from "./search.schemas";
import { searchVariants } from "./search.service";

export async function searchController(req: Request, res: Response) {
  const query = searchQuerySchema.parse(req.query);
  res.json(await searchVariants(query));
}
