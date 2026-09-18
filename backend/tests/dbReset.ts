import { PrismaClient } from "@prisma/client";

// Lógica compartida entre tests/helpers.ts (limpieza entre cada test, contra
// la branch fija) y tests/globalSetup.ts (limpieza inicial de la branch
// efímera): un solo lugar que sabe cómo vaciar el schema de test, con la
// misma protección contra apuntar a "public" en los dos casos.
export async function truncateAllTables(prisma: PrismaClient, schemaName: string | undefined): Promise<void> {
  if (!schemaName || schemaName === "public") {
    throw new Error(
      "truncateAllTables: el nombre de schema no puede estar vacío ni ser 'public' " +
        "(protección contra truncar por error la base de desarrollo)."
    );
  }

  const tables = await prisma.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables WHERE schemaname = $1 AND tablename != '_prisma_migrations';`,
    schemaName
  );
  if (tables.length === 0) return;

  const names = tables.map((t) => `"${schemaName}"."${t.tablename}"`).join(", ");
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE;`);

  // OrderNumberCounter es una fila fija (id=1), no una serial — TRUNCATE la
  // borra igual que cualquier otra tabla, y a diferencia de las demás no se
  // vuelve a sembrar sola. Sin esto, el primer test de cada archivo que crea
  // una orden dejaría la tabla vacía para TODOS los tests siguientes que
  // también creen una (generateOrderNumber haría un UPDATE sin filas
  // afectadas y la desestructuración de RETURNING explotaría). 0 es el valor
  // correcto acá: si DispatchOrder también quedó en 0 filas (que es
  // justamente lo que este TRUNCATE acaba de garantizar), el contador debe
  // arrancar en 0 también.
  if (tables.some((t) => t.tablename === "OrderNumberCounter")) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "${schemaName}"."OrderNumberCounter" ("id", "lastNumber") VALUES (1, 0);`
    );
  }
}
