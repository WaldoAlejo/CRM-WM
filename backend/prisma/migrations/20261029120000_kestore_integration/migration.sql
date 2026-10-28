-- CreateTable
CREATE TABLE "KestoreSyncState" (
    "variantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "stock" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KestoreSyncState_pkey" PRIMARY KEY ("variantId")
);

-- CreateTable
CREATE TABLE "KestoreOrder" (
    "id" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "dispatchOrderId" TEXT NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KestoreOrder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KestoreOrder_orderNumber_key" ON "KestoreOrder"("orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "KestoreOrder_dispatchOrderId_key" ON "KestoreOrder"("dispatchOrderId");

-- AddForeignKey
ALTER TABLE "KestoreSyncState" ADD CONSTRAINT "KestoreSyncState_variantId_fkey" FOREIGN KEY ("variantId") REFERENCES "ProductVariant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KestoreOrder" ADD CONSTRAINT "KestoreOrder_dispatchOrderId_fkey" FOREIGN KEY ("dispatchOrderId") REFERENCES "DispatchOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
