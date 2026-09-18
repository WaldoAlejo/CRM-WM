-- ============================================================================
-- Ajustes de la auditoría de schema (ver reporte previo a esta migración):
-- 1 CHECK de buyerType exclusivo, 2 índices de reporte, deletedAt/índice en
-- Brand, onDelete: Restrict en InventoryMovement.dispatchOrderItemId,
-- createdBy en Wholesaler/Shipment, createdAt/isActive en Courier, unique
-- compuesto en FinalCustomer, y 4 CHECK de rangos/cantidades.
-- Todo es aditivo o un endurecimiento de reglas que los datos actuales ya
-- cumplen (verificado antes de escribir esta migración).
-- ============================================================================

-- Antes de endurecer la FK, se quita la anterior (estaba en SetNull).
ALTER TABLE "InventoryMovement" DROP CONSTRAINT "InventoryMovement_dispatchOrderItemId_fkey";

-- Columnas nuevas.
ALTER TABLE "Courier" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Shipment" ADD COLUMN     "createdById" TEXT;

ALTER TABLE "Wholesaler" ADD COLUMN     "createdById" TEXT;

-- Índices nuevos.
CREATE INDEX "Brand_deletedAt_idx" ON "Brand"("deletedAt");
CREATE INDEX "DispatchOrder_dispatchDate_idx" ON "DispatchOrder"("dispatchDate");
CREATE INDEX "DispatchOrder_paymentStatus_dueDate_idx" ON "DispatchOrder"("paymentStatus", "dueDate");
CREATE UNIQUE INDEX "FinalCustomer_idType_idNumber_key" ON "FinalCustomer"("idType", "idNumber");

-- Foreign keys nuevas.
ALTER TABLE "Wholesaler" ADD CONSTRAINT "Wholesaler_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- FK endurecida: ya no se puede borrar un DispatchOrderItem que tenga
-- movimientos asociados (antes el movimiento sobrevivía pero perdía el
-- vínculo con la orden/ítem que lo originó).
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_dispatchOrderItemId_fkey" FOREIGN KEY ("dispatchOrderItemId") REFERENCES "DispatchOrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- CHECK constraints (defensa en profundidad: no reemplazan la validación de
-- la API, la respaldan a nivel de base de datos). Todos verificados contra
-- los datos actuales antes de aplicarlos.
-- ============================================================================

-- buyerType exclusivo: exactamente wholesalerId O finalCustomerId, nunca ambos, nunca ninguno.
ALTER TABLE "DispatchOrder" ADD CONSTRAINT "DispatchOrder_buyer_exactly_one_check" CHECK (
  ("buyerType" = 'MAYORISTA' AND "wholesalerId" IS NOT NULL AND "finalCustomerId" IS NULL) OR
  ("buyerType" = 'CLIENTE_FINAL' AND "finalCustomerId" IS NOT NULL AND "wholesalerId" IS NULL)
);

-- Un movimiento de inventario con cantidad 0 no representa nada real.
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_quantity_not_zero_check" CHECK ("quantity" <> 0);

-- Un ítem de despacho siempre despacha una cantidad positiva (los ajustes de
-- signo negativo se manejan en InventoryMovement, no aquí).
ALTER TABLE "DispatchOrderItem" ADD CONSTRAINT "DispatchOrderItem_quantity_positive_check" CHECK ("quantity" > 0);

ALTER TABLE "DispatchOrderItem" ADD CONSTRAINT "DispatchOrderItem_discountPct_range_check" CHECK ("discountPct" IS NULL OR ("discountPct" >= 0 AND "discountPct" <= 100));

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_wholesaleDiscountPct_range_check" CHECK ("wholesaleDiscountPct" IS NULL OR ("wholesaleDiscountPct" >= 0 AND "wholesaleDiscountPct" <= 100));

ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_retailDiscountPct_range_check" CHECK ("retailDiscountPct" IS NULL OR ("retailDiscountPct" >= 0 AND "retailDiscountPct" <= 100));
