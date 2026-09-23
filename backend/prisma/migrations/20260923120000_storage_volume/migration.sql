ALTER TABLE "Warehouse" ADD COLUMN "capacityCbm" DECIMAL(14,6);
ALTER TABLE "ProductVariant" ADD COLUMN "maxStackUnits" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_maxStackUnits_check" CHECK ("maxStackUnits" BETWEEN 1 AND 1000);
