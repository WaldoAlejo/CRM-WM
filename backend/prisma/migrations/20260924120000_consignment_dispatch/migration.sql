ALTER TYPE "PaymentMethod" ADD VALUE 'CONSIGNACION';
ALTER TABLE "DispatchOrder" ADD COLUMN "reviewIntervalDays" INTEGER NOT NULL DEFAULT 20;
ALTER TABLE "ConsignmentLot" ADD COLUMN "dispatchOrderId" TEXT;
CREATE UNIQUE INDEX "ConsignmentLot_dispatchOrderId_key" ON "ConsignmentLot"("dispatchOrderId");
ALTER TABLE "ConsignmentLot" ADD CONSTRAINT "ConsignmentLot_dispatchOrderId_fkey" FOREIGN KEY ("dispatchOrderId") REFERENCES "DispatchOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
