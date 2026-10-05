-- Número de factura emitida manualmente (fuera del sistema) por despacho.
ALTER TABLE "DispatchOrder" ADD COLUMN "manualInvoiceNumber" TEXT;

CREATE INDEX "DispatchOrder_manualInvoiceNumber_idx" ON "DispatchOrder"("manualInvoiceNumber");
