-- ============================================================================
-- Migración combinada: logística/certificaciones/marca/crédito/courier
-- (ninguna de esas dos tandas de cambios se había aplicado todavía) + el
-- reemplazo de Customer por Wholesaler/FinalCustomer.
--
-- A diferencia de una migración autogenerada normal, esta se escribió a mano
-- para PRESERVAR los datos existentes: la tabla Customer y la orden de
-- despacho que la referencia. El orden importa: primero se crean las tablas
-- nuevas y columnas nuevas (nullable), después se copian los datos viejos a
-- su nuevo lugar, y solo al final se endurecen las columnas a NOT NULL y se
-- borra lo viejo. Así nunca hay una ventana en la que los datos existan a
-- medias o se pierdan.
-- ============================================================================

-- 1. Enums nuevos (no dependen de nada existente).
CREATE TYPE "IdType" AS ENUM ('CEDULA', 'PASAPORTE', 'RUC');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDIENTE', 'PAGADO', 'PARCIAL');
CREATE TYPE "PaymentMethod" AS ENUM ('CONTADO', 'CREDITO', 'CONTRA_ENTREGA');
CREATE TYPE "BuyerType" AS ENUM ('MAYORISTA', 'CLIENTE_FINAL');
CREATE TYPE "ShipmentStatus" AS ENUM ('EN_TRANSITO', 'ENTREGADO', 'RECHAZADO', 'PERDIDO', 'DANADO');
CREATE TYPE "ClaimStatus" AS ENUM ('PENDIENTE', 'EN_REVISION', 'APROBADO', 'RECHAZADO', 'PAGADO');

-- 2. Valores nuevos en el enum existente MovementType.
ALTER TYPE "MovementType" ADD VALUE 'DEVOLUCION';
ALTER TYPE "MovementType" ADD VALUE 'SINIESTRO';

-- 3. Columnas puramente aditivas (no afectan filas existentes).
ALTER TABLE "ImportBatch"
  ADD COLUMN "customsCost" DECIMAL(10,2),
  ADD COLUMN "freightCost" DECIMAL(10,2),
  ADD COLUMN "otherCosts" DECIMAL(10,2);

ALTER TABLE "Product" ADD COLUMN "brandId" TEXT;

ALTER TABLE "ProductVariant"
  ADD COLUMN "dimensionsCm" TEXT,
  ADD COLUMN "reservedStock" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "weightKg" DECIMAL(10,3);

-- 4. InventoryMovement.dispatchOrderItemId deja de ser 1 a 1 (ver comentario
-- en schema.prisma): se quita el índice único y se deja uno normal. La
-- foreign key en sí no cambia.
DROP INDEX "InventoryMovement_dispatchOrderItemId_key";
CREATE INDEX "InventoryMovement_dispatchOrderItemId_idx" ON "InventoryMovement"("dispatchOrderItemId");

-- 5. Tablas nuevas.
CREATE TABLE "Wholesaler" (
    "id" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "ruc" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "creditLimit" DECIMAL(10,2),
    "defaultCreditDays" INTEGER,
    "rucValidationStatus" TEXT,
    "rucValidationResponse" JSONB,
    "rucValidatedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Wholesaler_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FinalCustomer" (
    "id" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "idType" "IdType" NOT NULL DEFAULT 'CEDULA',
    "idNumber" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FinalCustomer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Certification" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "certNumber" TEXT,
    "issuedDate" TIMESTAMP(3),
    "fileUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Certification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductAttachment" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductAttachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "dispatchOrderId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "method" TEXT NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Courier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactInfo" TEXT,
    CONSTRAINT "Courier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL,
    "dispatchOrderId" TEXT NOT NULL,
    "courierId" TEXT NOT NULL,
    "trackingNumber" TEXT,
    "isCOD" BOOLEAN NOT NULL,
    "codAmountExpected" DECIMAL(10,2),
    "codAmountCollected" DECIMAL(10,2),
    "status" "ShipmentStatus" NOT NULL DEFAULT 'EN_TRANSITO',
    "deliveredAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "courierSettledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "InsuranceClaim" (
    "id" TEXT NOT NULL,
    "shipmentId" TEXT NOT NULL,
    "claimAmount" DECIMAL(10,2) NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'PENDIENTE',
    "reimbursedAmount" DECIMAL(10,2),
    "claimDate" TIMESTAMP(3) NOT NULL,
    "resolvedDate" TIMESTAMP(3),
    "notes" TEXT,
    CONSTRAINT "InsuranceClaim_pkey" PRIMARY KEY ("id")
);

-- 6. Índices de las tablas nuevas.
CREATE UNIQUE INDEX "Wholesaler_ruc_key" ON "Wholesaler"("ruc");
CREATE INDEX "Wholesaler_businessName_idx" ON "Wholesaler"("businessName");
CREATE INDEX "Wholesaler_deletedAt_idx" ON "Wholesaler"("deletedAt");

CREATE INDEX "FinalCustomer_fullName_idx" ON "FinalCustomer"("fullName");
CREATE INDEX "FinalCustomer_idNumber_idx" ON "FinalCustomer"("idNumber");
CREATE INDEX "FinalCustomer_deletedAt_idx" ON "FinalCustomer"("deletedAt");

CREATE UNIQUE INDEX "Brand_name_key" ON "Brand"("name");
CREATE INDEX "Certification_productId_idx" ON "Certification"("productId");
CREATE INDEX "ProductAttachment_productId_idx" ON "ProductAttachment"("productId");

CREATE INDEX "Payment_dispatchOrderId_idx" ON "Payment"("dispatchOrderId");
CREATE INDEX "Payment_paidAt_idx" ON "Payment"("paidAt");

CREATE UNIQUE INDEX "Courier_name_key" ON "Courier"("name");
CREATE UNIQUE INDEX "Shipment_dispatchOrderId_key" ON "Shipment"("dispatchOrderId");
CREATE INDEX "Shipment_courierId_idx" ON "Shipment"("courierId");
CREATE INDEX "Shipment_status_idx" ON "Shipment"("status");
CREATE UNIQUE INDEX "InsuranceClaim_shipmentId_key" ON "InsuranceClaim"("shipmentId");
CREATE INDEX "InsuranceClaim_status_idx" ON "InsuranceClaim"("status");

-- 7. DispatchOrder: se quita la FK vieja hacia Customer (la columna y sus
-- datos se conservan un momento más, hasta el paso 9, para poder copiarlos).
ALTER TABLE "DispatchOrder" DROP CONSTRAINT "DispatchOrder_customerId_fkey";

-- Columnas nuevas. buyerType/shippingProvince/shippingCity quedan NULLABLE
-- por ahora a propósito: la tabla ya tiene 1 fila y todavía no le hemos
-- copiado sus datos. Se endurecen a NOT NULL en el paso 10, después del
-- backfill del paso 9.
ALTER TABLE "DispatchOrder"
  ADD COLUMN "amountPaid" DECIMAL(10,2),
  ADD COLUMN "buyerType" "BuyerType",
  ADD COLUMN "creditDays" INTEGER,
  ADD COLUMN "dueDate" TIMESTAMP(3),
  ADD COLUMN "finalCustomerId" TEXT,
  ADD COLUMN "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CONTADO',
  ADD COLUMN "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'PENDIENTE',
  ADD COLUMN "shippingCity" TEXT,
  ADD COLUMN "shippingProvince" TEXT,
  ADD COLUMN "wholesalerId" TEXT;

CREATE INDEX "DispatchOrder_wholesalerId_idx" ON "DispatchOrder"("wholesalerId");
CREATE INDEX "DispatchOrder_finalCustomerId_idx" ON "DispatchOrder"("finalCustomerId");

-- 8. Foreign keys de todo lo nuevo.
ALTER TABLE "Product" ADD CONSTRAINT "Product_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Certification" ADD CONSTRAINT "Certification_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductAttachment" ADD CONSTRAINT "ProductAttachment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_wholesalerId_fkey" FOREIGN KEY ("wholesalerId") REFERENCES "Wholesaler"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_finalCustomerId_fkey" FOREIGN KEY ("finalCustomerId") REFERENCES "FinalCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_dispatchOrderId_fkey" FOREIGN KEY ("dispatchOrderId") REFERENCES "DispatchOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_dispatchOrderId_fkey" FOREIGN KEY ("dispatchOrderId") REFERENCES "DispatchOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_courierId_fkey" FOREIGN KEY ("courierId") REFERENCES "Courier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InsuranceClaim" ADD CONSTRAINT "InsuranceClaim_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- 9. MIGRACIÓN DE DATOS (esta parte NO la genera Prisma automáticamente).
--
-- La tabla Customer original nunca llegó a tener una columna `type`
-- mayorista/final (esa migración nunca se aplicó), así que no hay forma de
-- distinguir por dato real cuáles de sus filas eran mayoristas. Con los
-- datos actuales (una sola fila, el cliente demo de pruebas) se asume que
-- todo registro existente es un cliente final, que es correcto para este
-- caso. Se reutiliza el mismo id para poder enlazar sin JOIN.
-- ============================================================================

INSERT INTO "FinalCustomer" (id, "fullName", "idType", "idNumber", phone, email, address, "deletedAt", "createdAt", "updatedAt")
SELECT id, name, 'CEDULA', "idNumber", phone, email, address, "deletedAt", "createdAt", "updatedAt"
FROM "Customer";

UPDATE "DispatchOrder"
SET "finalCustomerId" = "customerId", "buyerType" = 'CLIENTE_FINAL'
WHERE "customerId" IS NOT NULL;

-- Salvaguarda: órdenes sin comprador asignado (no hay ninguna hoy, pero si
-- las hubiera, no deben quedar con buyerType nulo). Quedan como
-- CLIENTE_FINAL sin finalCustomerId, visibles para revisión manual.
UPDATE "DispatchOrder" SET "buyerType" = 'CLIENTE_FINAL' WHERE "buyerType" IS NULL;

-- shippingProvince/shippingCity nunca se capturaron antes de este cambio.
-- Se usa la ubicación conocida del cliente demo (Quito) como valor de
-- relleno para no dejar filas inválidas; los pedidos nuevos deberán
-- enviar siempre este dato desde la API.
UPDATE "DispatchOrder" SET "shippingProvince" = 'Pichincha', "shippingCity" = 'Quito'
WHERE "shippingProvince" IS NULL OR "shippingCity" IS NULL;

-- 10. Con los datos ya copiados, se endurecen las columnas a NOT NULL.
ALTER TABLE "DispatchOrder"
  ALTER COLUMN "buyerType" SET NOT NULL,
  ALTER COLUMN "shippingProvince" SET NOT NULL,
  ALTER COLUMN "shippingCity" SET NOT NULL;

-- 11. Se elimina lo viejo, ya sin datos que perder.
ALTER TABLE "DispatchOrder" DROP COLUMN "customerId";
DROP TABLE "Customer";
