import { z } from "zod";

// Espejo de backend/src/modules/shipments/shipments.schemas.ts.
export const deliverShipmentSchema = z.object({
  codAmountCollected: z.coerce.number().nonnegative("No puede ser negativo"),
});
export type DeliverShipmentFormValues = z.infer<typeof deliverShipmentSchema>;

export const rejectShipmentSchema = z.object({
  rejectionReason: z.string().min(1, "El motivo de rechazo es obligatorio").max(500),
});
export type RejectShipmentFormValues = z.infer<typeof rejectShipmentSchema>;

// Aunque ShipmentStatus tenga más valores, este endpoint puntual solo acepta
// estos dos (ver lostOrDamagedShipmentSchema del backend).
export const lostOrDamagedShipmentSchema = z.object({
  status: z.enum(["PERDIDO", "DANADO"]),
});
export type LostOrDamagedShipmentFormValues = z.infer<typeof lostOrDamagedShipmentSchema>;

export const deliverShipmentDefaultValues: DeliverShipmentFormValues = { codAmountCollected: 0 };
export const rejectShipmentDefaultValues: RejectShipmentFormValues = { rejectionReason: "" };
export const lostOrDamagedShipmentDefaultValues: LostOrDamagedShipmentFormValues = { status: "PERDIDO" };
