import { Request, Response } from "express";
import {
  deliverShipmentSchema,
  lostOrDamagedShipmentSchema,
  rejectShipmentSchema,
} from "./shipments.schemas";
import { deliverShipment, markShipmentLostOrDamaged, rejectShipment } from "./shipments.service";

export async function deliverShipmentController(req: Request, res: Response) {
  const { codAmountCollected } = deliverShipmentSchema.parse(req.body);
  res.json(await deliverShipment(req.params.id, codAmountCollected, req.user!.id));
}

export async function rejectShipmentController(req: Request, res: Response) {
  const { rejectionReason } = rejectShipmentSchema.parse(req.body);
  res.json(await rejectShipment(req.params.id, rejectionReason, req.user!.id));
}

export async function lostOrDamagedShipmentController(req: Request, res: Response) {
  const { status } = lostOrDamagedShipmentSchema.parse(req.body);
  res.json(await markShipmentLostOrDamaged(req.params.id, status, req.user!.id));
}
