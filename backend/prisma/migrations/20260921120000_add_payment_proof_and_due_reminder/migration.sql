-- AlterTable
ALTER TABLE "DispatchOrder" ADD COLUMN     "remindedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "proofFile" TEXT;

