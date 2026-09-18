-- AlterTable
ALTER TABLE "DispatchOrderItem" ADD COLUMN     "landedCostSnapshot" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "landedCostPerUnit" DECIMAL(10,2);
