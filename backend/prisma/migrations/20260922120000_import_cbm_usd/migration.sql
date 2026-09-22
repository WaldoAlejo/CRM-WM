-- Historical CNY values stay in their original column; they are never relabeled as USD.
ALTER TABLE "ProductVariant" ADD COLUMN "costPriceUSD" DECIMAL(10,2);
ALTER TABLE "ImportBatch" ADD COLUMN "containerType" TEXT, ADD COLUMN "containerCbm" DECIMAL(12,6);
ALTER TABLE "InventoryMovement" ADD COLUMN "volumeCbm" DECIMAL(12,6), ALTER COLUMN "landedCostPerUnit" TYPE DECIMAL(18,6);
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_containerCbm_positive" CHECK ("containerCbm" > 0), ADD CONSTRAINT "ImportBatch_containerType_valid" CHECK ("containerType" IN ('20', '40', '40HC'));
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_volumeCbm_positive" CHECK ("volumeCbm" > 0);
