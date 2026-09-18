/*
  Warnings:

  - Added the required column `expectedResolutionDate` to the `InsuranceClaim` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "CustomerResolution" AS ENUM ('PENDIENTE', 'REEMPLAZO', 'REEMBOLSO');

-- AlterTable
ALTER TABLE "DispatchOrder" ADD COLUMN     "replacesOrderId" TEXT;

-- AlterTable
ALTER TABLE "InsuranceClaim" ADD COLUMN     "customerResolution" "CustomerResolution" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN     "expectedResolutionDate" TIMESTAMP(3) NOT NULL;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "insuranceClaimId" TEXT;

-- AddForeignKey
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_replacesOrderId_fkey" FOREIGN KEY ("replacesOrderId") REFERENCES "DispatchOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_insuranceClaimId_fkey" FOREIGN KEY ("insuranceClaimId") REFERENCES "InsuranceClaim"("id") ON DELETE SET NULL ON UPDATE CASCADE;
