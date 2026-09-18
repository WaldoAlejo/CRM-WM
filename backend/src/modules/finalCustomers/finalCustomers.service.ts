import { IdType, Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { conflict, notFound } from "../../utils/httpError";

// El único índice único de esta tabla es parcial y compuesto
// (idType+idNumber, WHERE "deletedAt" IS NULL, ver migración
// 20260917043052) — un P2002 acá solo puede ser por esa combinación.
function mapUniqueConstraintError(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    throw conflict("Ya existe un cliente final con ese tipo y número de identificación", {
      field: "idNumber",
    });
  }
  throw err;
}

interface ListFinalCustomersParams {
  page: number;
  pageSize: number;
  q?: string;
}

export async function listFinalCustomers(params: ListFinalCustomersParams) {
  const { page, pageSize, q } = params;
  const where: Prisma.FinalCustomerWhereInput = {
    deletedAt: null,
    // Mismo patrón que search.service.ts: contains/insensitive sobre los
    // campos por los que alguien realmente buscaría a un cliente al armar
    // una orden (nombre, cédula/RUC, teléfono) — necesario porque, a
    // diferencia de Wholesaler (lista chica, se filtra en el cliente), acá
    // el listado está paginado desde el diseño original.
    ...(q && {
      OR: [
        { fullName: { contains: q, mode: "insensitive" } },
        { idNumber: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
      ],
    }),
  };

  const [rows, total] = await Promise.all([
    prisma.finalCustomer.findMany({
      where,
      orderBy: { fullName: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.finalCustomer.count({ where }),
  ]);

  return {
    data: rows,
    pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
  };
}

export async function getFinalCustomerById(id: string) {
  const finalCustomer = await prisma.finalCustomer.findFirst({ where: { id, deletedAt: null } });
  if (!finalCustomer) throw notFound("Cliente final no encontrado");
  return finalCustomer;
}

interface FinalCustomerInput {
  fullName?: string;
  idType?: IdType;
  idNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export async function createFinalCustomer(data: FinalCustomerInput) {
  try {
    return await prisma.finalCustomer.create({ data: { ...data, fullName: data.fullName! } });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

export async function updateFinalCustomer(id: string, data: FinalCustomerInput) {
  await getFinalCustomerById(id); // valida que exista y no esté eliminado

  try {
    return await prisma.finalCustomer.update({ where: { id }, data });
  } catch (err) {
    mapUniqueConstraintError(err);
  }
}

// Sin bloqueo por DispatchOrder dependientes: son historial inmutable, igual
// que ImportBatch para Supplier — una orden vieja sigue mostrando el nombre
// del cliente aunque este ya no esté activo en el catálogo.
export async function softDeleteFinalCustomer(id: string) {
  const finalCustomer = await getFinalCustomerById(id);
  return prisma.finalCustomer.update({
    where: { id: finalCustomer.id },
    data: { deletedAt: new Date() },
  });
}
