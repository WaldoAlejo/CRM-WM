import { Request, Response } from "express";
import {
  listInsuranceClaimsQuerySchema,
  resolveCustomerSchema,
  updateInsuranceClaimSchema,
} from "./insuranceClaims.schemas";
import { listInsuranceClaims, resolveCustomer, updateInsuranceClaim } from "./insuranceClaims.service";

export async function resolveCustomerController(req: Request, res: Response) {
  const data = resolveCustomerSchema.parse(req.body);
  const result = await resolveCustomer(req.params.id, data, req.user!.id, req.user!.role);
  res.status(201).json(result);
}

export async function updateInsuranceClaimController(req: Request, res: Response) {
  const data = updateInsuranceClaimSchema.parse(req.body);
  res.json(await updateInsuranceClaim(req.params.id, data));
}

export async function listInsuranceClaimsController(req: Request, res: Response) {
  const query = listInsuranceClaimsQuerySchema.parse(req.query);
  res.json(await listInsuranceClaims(query));
}
