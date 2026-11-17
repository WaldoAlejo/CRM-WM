/*
  Warnings:

  - The primary key for the `KestoreSyncState` table will be changed. If it partially fails, the table could be left without primary key constraint.

*/
-- CreateEnum
CREATE TYPE "KestoreTarget" AS ENUM ('PROD', 'DEV');

-- Lo enviado hasta hoy fue al destino KESTORE_WEBHOOK_URL: queda como PROD.
-- AlterTable
ALTER TABLE "KestoreSyncState" DROP CONSTRAINT "KestoreSyncState_pkey",
ADD COLUMN     "target" "KestoreTarget" NOT NULL DEFAULT 'PROD',
ADD CONSTRAINT "KestoreSyncState_pkey" PRIMARY KEY ("variantId", "target");

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "kestoreDevOnly" BOOLEAN NOT NULL DEFAULT false;
