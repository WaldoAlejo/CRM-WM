import { z } from "zod";

export const deliverShipmentSchema = z.object({
  codAmountCollected: z.number().nonnegative(),
});

export const rejectShipmentSchema = z.object({
  rejectionReason: z.string().min(1, "El motivo de rechazo es obligatorio").max(500),
});

// Solo estos dos valores, aunque ShipmentStatus tenga más: este endpoint es
// específicamente para el escenario de pérdida/daño del courier.
export const lostOrDamagedShipmentSchema = z.object({
  status: z.enum(["PERDIDO", "DANADO"]),
});
