-- Canales de publicación del producto y código de la variante en Kestore.
ALTER TABLE "Product" ADD COLUMN "showOnWm" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "showOnKestore" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ProductVariant" ADD COLUMN "kestoreCode" TEXT;
CREATE UNIQUE INDEX "ProductVariant_kestoreCode_key" ON "ProductVariant"("kestoreCode");
