// ============================================================================
// Deja los productos de la importación IMP-000004 como "Kestore: solo
// kestore-dev (en prueba)": kestore-dev los sigue publicando y Kestore
// producción los recibe inactivos hasta que se desmarquen en el CRM.
//
// Correrlo DESPUÉS de configurar KESTORE_DEV_WEBHOOK_URL y
// KESTORE_DEV_WEBHOOK_SECRET en el CRM y el mismo secreto en kestore-dev
// (WmCrm__Secret): si kestore-dev todavía firma con el secreto de producción,
// su conciliación los vería inactivos.
//
// Por defecto solo muestra lo que haría. Para escribir:
//   npx ts-node prisma/imports/kestoreImp4DevOnly.ts --apply
// ============================================================================

import { MovementType, PrismaClient } from "@prisma/client";

const BATCH_REFERENCE = "IMP-000004";
const prisma = new PrismaClient();

async function main() {
  const apply = process.argv.includes("--apply");
  const batch = await prisma.importBatch.findFirstOrThrow({ where: { reference: BATCH_REFERENCE } });
  const products = await prisma.product.findMany({
    where: { variants: { some: { movements: { some: { importBatchId: batch.id, type: MovementType.INGRESO } } } } },
    select: { id: true, name: true, kestoreDevOnly: true },
    orderBy: { name: "asc" },
  });
  const pending = products.filter((p) => !p.kestoreDevOnly);
  for (const p of products) console.log(`${p.kestoreDevOnly ? "=" : "+"} ${p.name.trim()}`);
  console.log(`${products.length} productos, ${pending.length} por marcar. ${apply ? "APLICANDO" : "Simulación (usa --apply para escribir)"}`);
  if (apply && pending.length) {
    await prisma.product.updateMany({ where: { id: { in: pending.map((p) => p.id) } }, data: { kestoreDevOnly: true } });
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
