/*
  Warnings:

  - Added the required column `priceType` to the `DispatchOrderItem` table without a default value. This is not possible if the table is not empty.
  - Added the required column `unitPrice` to the `DispatchOrderItem` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PriceType" AS ENUM ('MAYORISTA', 'PVP');

-- AlterTable
ALTER TABLE "DispatchOrderItem" ADD COLUMN     "discountPct" DECIMAL(5,2),
ADD COLUMN     "priceType" "PriceType" NOT NULL,
ADD COLUMN     "unitCostSnapshot" DECIMAL(10,2),
ADD COLUMN     "unitPrice" DECIMAL(10,2) NOT NULL;

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "unitCost" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "ProductVariant" ADD COLUMN     "costPriceCNY" DECIMAL(10,2),
ADD COLUMN     "retailDiscountPct" DECIMAL(5,2),
ADD COLUMN     "retailPrice" DECIMAL(10,2),
ADD COLUMN     "wholesaleDiscountPct" DECIMAL(5,2),
ADD COLUMN     "wholesalePrice" DECIMAL(10,2);
