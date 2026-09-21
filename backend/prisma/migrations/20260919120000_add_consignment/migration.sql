-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('STANDARD', 'CUARENTENA');

-- CreateEnum
CREATE TYPE "DispatchOrderOrigin" AS ENUM ('NORMAL', 'CONSIGNACION_LIQUIDACION', 'CONSIGNACION_DEVOLUCION_NO_CONFORME');

-- CreateEnum
CREATE TYPE "ConsignmentStatus" AS ENUM ('EN_CONSIGNACION', 'LIQUIDADO_PARCIAL', 'CERRADO');

-- CreateEnum
CREATE TYPE "ReviewAction" AS ENUM ('EXTENDER', 'LIQUIDAR');

-- CreateEnum
CREATE TYPE "ReturnSource" AS ENUM ('CONSIGNACION', 'COURIER_RECHAZADO');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PASA', 'NO_PASA');

-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'CONSIGNACION';

-- AlterTable
ALTER TABLE "DispatchOrder" ADD COLUMN     "consignmentReviewId" TEXT,
ADD COLUMN     "origin" "DispatchOrderOrigin" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "returnBatchId" TEXT;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "originMovementId" TEXT;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "type" "LocationType" NOT NULL DEFAULT 'STANDARD';

-- CreateTable
CREATE TABLE "ConsignmentLot" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "wholesalerId" TEXT NOT NULL,
    "shippingProvince" TEXT NOT NULL,
    "shippingCity" TEXT NOT NULL,
    "deliveredAt" TIMESTAMP(3) NOT NULL,
    "reviewIntervalDays" INTEGER NOT NULL DEFAULT 20,
    "creditDays" INTEGER NOT NULL,
    "nextReviewDate" TIMESTAMP(3) NOT NULL,
    "status" "ConsignmentStatus" NOT NULL DEFAULT 'EN_CONSIGNACION',
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConsignmentLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentLine" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "originLocationId" TEXT,
    "quantityDelivered" INTEGER NOT NULL,
    "unitPrice" DECIMAL(10,2) NOT NULL,
    "unitCostSnapshot" DECIMAL(10,2),
    "landedCostSnapshot" DECIMAL(10,2),
    "deliveryMovementId" TEXT NOT NULL,

    CONSTRAINT "ConsignmentLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentReview" (
    "id" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "action" "ReviewAction" NOT NULL,
    "nextReviewDate" TIMESTAMP(3),
    "notes" TEXT,
    "registeredById" TEXT,

    CONSTRAINT "ConsignmentReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConsignmentReviewLine" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "quantitySold" INTEGER NOT NULL,
    "quantityReturned" INTEGER NOT NULL,

    CONSTRAINT "ConsignmentReviewLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnBatch" (
    "id" TEXT NOT NULL,
    "source" "ReturnSource" NOT NULL,
    "reviewId" TEXT,
    "shipmentId" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnLine" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "variantId" TEXT NOT NULL,
    "originLocationId" TEXT,
    "quarantineLocationId" TEXT,
    "originMovementId" TEXT,
    "quantity" INTEGER NOT NULL,
    "inspectedQuantity" INTEGER NOT NULL DEFAULT 0,
    "unitPrice" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "ReturnLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnInspection" (
    "id" TEXT NOT NULL,
    "returnLineId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "boxOk" BOOLEAN NOT NULL,
    "noVisibleDamage" BOOLEAN NOT NULL,
    "piecesComplete" BOOLEAN NOT NULL,
    "observation" TEXT,
    "result" "InspectionResult" NOT NULL,
    "reentryMovementId" TEXT,
    "inspectedById" TEXT,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReturnInspection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentLot_code_key" ON "ConsignmentLot"("code");

-- CreateIndex
CREATE INDEX "ConsignmentLot_wholesalerId_idx" ON "ConsignmentLot"("wholesalerId");

-- CreateIndex
CREATE INDEX "ConsignmentLot_status_nextReviewDate_idx" ON "ConsignmentLot"("status", "nextReviewDate");

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentLine_deliveryMovementId_key" ON "ConsignmentLine"("deliveryMovementId");

-- CreateIndex
CREATE INDEX "ConsignmentLine_lotId_idx" ON "ConsignmentLine"("lotId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentLine_lotId_variantId_key" ON "ConsignmentLine"("lotId", "variantId");

-- CreateIndex
CREATE INDEX "ConsignmentReview_lotId_idx" ON "ConsignmentReview"("lotId");

-- CreateIndex
CREATE INDEX "ConsignmentReviewLine_lineId_idx" ON "ConsignmentReviewLine"("lineId");

-- CreateIndex
CREATE UNIQUE INDEX "ConsignmentReviewLine_reviewId_lineId_key" ON "ConsignmentReviewLine"("reviewId", "lineId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnBatch_reviewId_key" ON "ReturnBatch"("reviewId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnBatch_shipmentId_key" ON "ReturnBatch"("shipmentId");

-- CreateIndex
CREATE INDEX "ReturnBatch_completedAt_idx" ON "ReturnBatch"("completedAt");

-- CreateIndex
CREATE INDEX "ReturnLine_batchId_idx" ON "ReturnLine"("batchId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnInspection_reentryMovementId_key" ON "ReturnInspection"("reentryMovementId");

-- CreateIndex
CREATE INDEX "ReturnInspection_returnLineId_idx" ON "ReturnInspection"("returnLineId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOrder_consignmentReviewId_key" ON "DispatchOrder"("consignmentReviewId");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchOrder_returnBatchId_key" ON "DispatchOrder"("returnBatchId");

-- CreateIndex
CREATE INDEX "InventoryMovement_originMovementId_idx" ON "InventoryMovement"("originMovementId");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_originMovementId_fkey" FOREIGN KEY ("originMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_consignmentReviewId_fkey" FOREIGN KEY ("consignmentReviewId") REFERENCES "ConsignmentReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_returnBatchId_fkey" FOREIGN KEY ("returnBatchId") REFERENCES "ReturnBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentLot" ADD CONSTRAINT "ConsignmentLot_wholesalerId_fkey" FOREIGN KEY ("wholesalerId") REFERENCES "Wholesaler"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentLot" ADD CONSTRAINT "ConsignmentLot_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentLine" ADD CONSTRAINT "ConsignmentLine_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "ConsignmentLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentLine" ADD CONSTRAINT "ConsignmentLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentLine" ADD CONSTRAINT "ConsignmentLine_originLocationId_fkey" FOREIGN KEY ("originLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentLine" ADD CONSTRAINT "ConsignmentLine_deliveryMovementId_fkey" FOREIGN KEY ("deliveryMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentReview" ADD CONSTRAINT "ConsignmentReview_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "ConsignmentLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentReview" ADD CONSTRAINT "ConsignmentReview_registeredById_fkey" FOREIGN KEY ("registeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentReviewLine" ADD CONSTRAINT "ConsignmentReviewLine_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ConsignmentReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConsignmentReviewLine" ADD CONSTRAINT "ConsignmentReviewLine_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "ConsignmentLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnBatch" ADD CONSTRAINT "ReturnBatch_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "ConsignmentReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnBatch" ADD CONSTRAINT "ReturnBatch_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ReturnBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_originLocationId_fkey" FOREIGN KEY ("originLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_quarantineLocationId_fkey" FOREIGN KEY ("quarantineLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnLine" ADD CONSTRAINT "ReturnLine_originMovementId_fkey" FOREIGN KEY ("originMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnInspection" ADD CONSTRAINT "ReturnInspection_returnLineId_fkey" FOREIGN KEY ("returnLineId") REFERENCES "ReturnLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnInspection" ADD CONSTRAINT "ReturnInspection_reentryMovementId_fkey" FOREIGN KEY ("reentryMovementId") REFERENCES "InventoryMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnInspection" ADD CONSTRAINT "ReturnInspection_inspectedById_fkey" FOREIGN KEY ("inspectedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Ajustes a mano (Prisma DSL no los expresa)
-- ---------------------------------------------------------------------------

-- Una sola ubicación CUARENTENA ACTIVA por bodega.
CREATE UNIQUE INDEX "Location_one_active_quarantine_per_warehouse"
  ON "Location" ("warehouseId")
  WHERE "type" = 'CUARENTENA' AND "isActive" = true;

-- Contador de códigos de lote de consignación (CON-000001): segunda fila de
-- OrderNumberCounter (la id=1 sigue siendo la de las órdenes OD-).
INSERT INTO "OrderNumberCounter" ("id", "lastNumber") VALUES (2, 0)
ON CONFLICT ("id") DO NOTHING;

-- Datos: crea la ubicación de Cuarentena/Validación de CADA bodega existente
-- (sin esto el sistema no podría recibir ninguna devolución hasta que alguien
-- la creara a mano). Idempotente: no duplica si ya hubiera una activa.
INSERT INTO "Location" ("id", "warehouseId", "code", "type", "isActive", "createdAt", "updatedAt")
SELECT
  'cq' || md5(w."id" || clock_timestamp()::text || random()::text),
  w."id", 'Cuarentena', 'CUARENTENA', true, now(), now()
FROM "Warehouse" w
WHERE w."isActive" = true
  AND NOT EXISTS (
    SELECT 1 FROM "Location" l
    WHERE l."warehouseId" = w."id" AND l."type" = 'CUARENTENA' AND l."isActive" = true
  )
  AND NOT EXISTS (
    SELECT 1 FROM "Location" l WHERE l."warehouseId" = w."id" AND l."code" = 'Cuarentena'
  );
