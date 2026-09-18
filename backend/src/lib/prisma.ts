// Cliente Prisma único compartido por toda la app (evitar crear una conexión
// nueva por archivo/request).
import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
