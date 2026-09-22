-- AlterTable
ALTER TABLE "Warehouse" ADD COLUMN     "capacity" INTEGER,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT;

-- CreateIndex
CREATE INDEX "Warehouse_managerId_idx" ON "Warehouse"("managerId");

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

