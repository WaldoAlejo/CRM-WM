-- DropIndex
DROP INDEX "Brand_name_key";

-- DropIndex
DROP INDEX "FinalCustomer_idType_idNumber_key";

-- DropIndex
DROP INDEX "Supplier_name_key";

-- CreateIndex
CREATE INDEX "Supplier_deletedAt_idx" ON "Supplier"("deletedAt");

-- Índices únicos PARCIALES: solo exigen unicidad entre los registros NO
-- eliminados. Prisma DSL no soporta WHERE en @unique/@@unique, por eso van a
-- mano acá en vez de en schema.prisma. Objetivo: un registro soft-deleted
-- nunca debe bloquear crear uno nuevo con el mismo valor.
CREATE UNIQUE INDEX "Supplier_name_active_key" ON "Supplier"("name") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "Brand_name_active_key" ON "Brand"("name") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "FinalCustomer_idType_idNumber_active_key" ON "FinalCustomer"("idType", "idNumber") WHERE "deletedAt" IS NULL;
