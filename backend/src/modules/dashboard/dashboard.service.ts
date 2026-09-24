// Resumen para la landing tras login: un solo endpoint (GET /dashboard/summary)
// en vez de varios livianos — el frontend siempre necesita TODOS estos
// bloques apenas carga la página, así que separarlos en N requests solo
// multiplicaría la ida y vuelta de auth+red sin bajar el costo real de
// queries (cada bloque ya es barato: counts, un top-5, sumas sobre un
// puñado de filas). Todo corre en paralelo con Promise.all.
//
// Ningún número acá se recalcula "a mano": cada bloque reusa la MISMA
// función/definición que ya usa su módulo dueño (stock bajo → getStockSummary
// de Inventario, cartera vencida → getAccountsReceivableSummary de Despachos,
// reclamos en proceso → OPEN_STATUSES de Reclamos de Seguro, ventas →
// classifySaleByShipment, la misma regla que ya usa Reportes).
import { DispatchStatus, Prisma, Role, ShipmentStatus } from "@prisma/client";
import { classifySaleByShipment } from "../../lib/dispatchSaleClassification";
import { prisma } from "../../lib/prisma";
import { hasAdminAccess } from "../../lib/roles";
import { countOverdueReviews } from "../consignment/consignment.service";
import { getAccountsReceivableSummary } from "../dispatchOrders/dispatchOrders.service";
import { OPEN_STATUSES } from "../insuranceClaims/insuranceClaims.service";
import { getStockSummary } from "../inventory/inventory.service";

const { Decimal } = Prisma;

function startOfUTCDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function startOfUTCMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

// Trae las líneas despachadas del rango y filtra a las que realmente cuentan
// como "vendidas" (mismo criterio que reports.service.ts: excluye
// RECHAZADO — volvió a bodega — y PERDIDO/DANADO sin reclamo PAGADO todavía).
// `includeCost=false` NI SIQUIERA selecciona unitCostSnapshot/landedCostSnapshot
// en la query — para OPERATOR, el costo no se trae de la base, no solo se
// oculta después de calcularlo.
async function getSalesRevenueOnly(dateFrom: Date, dateTo: Date) {
  const items = await prisma.dispatchOrderItem.findMany({
    where: {
      dispatchOrder: { deletedAt: null, status: DispatchStatus.DESPACHADO, paymentMethod: { not: "CONSIGNACION" }, dispatchDate: { gte: dateFrom, lte: dateTo } },
    },
    select: {
      quantity: true,
      unitPrice: true,
      dispatchOrder: { select: { shipment: { select: { status: true, claim: { select: { status: true } } } } } },
    },
  });

  let unitsSold = 0;
  let totalRevenue = new Decimal(0);
  for (const item of items) {
    if (classifySaleByShipment(item.dispatchOrder.shipment) !== "SOLD") continue;
    unitsSold += item.quantity;
    totalRevenue = totalRevenue.plus(item.unitPrice.times(item.quantity));
  }

  return { unitsSold, totalRevenue: totalRevenue.toDecimalPlaces(2) };
}

async function getSalesWithCost(dateFrom: Date, dateTo: Date) {
  const items = await prisma.dispatchOrderItem.findMany({
    where: {
      dispatchOrder: { deletedAt: null, status: DispatchStatus.DESPACHADO, paymentMethod: { not: "CONSIGNACION" }, dispatchDate: { gte: dateFrom, lte: dateTo } },
    },
    select: {
      quantity: true,
      unitPrice: true,
      unitCostSnapshot: true,
      landedCostSnapshot: true,
      dispatchOrder: { select: { shipment: { select: { status: true, claim: { select: { status: true } } } } } },
    },
  });

  let unitsSold = 0;
  let totalRevenue = new Decimal(0);
  let totalCost = new Decimal(0);
  for (const item of items) {
    if (classifySaleByShipment(item.dispatchOrder.shipment) !== "SOLD") continue;
    unitsSold += item.quantity;
    totalRevenue = totalRevenue.plus(item.unitPrice.times(item.quantity));
    // Mismo criterio que reports.service.ts: landedCostSnapshot ya es el
    // costo de aterrizaje COMPLETO cuando existe; solo cae a unitCostSnapshot
    // en órdenes confirmadas antes de que ese campo existiera.
    const unitCost = item.landedCostSnapshot ?? item.unitCostSnapshot ?? new Decimal(0);
    totalCost = totalCost.plus(unitCost.times(item.quantity));
  }

  totalRevenue = totalRevenue.toDecimalPlaces(2);
  totalCost = totalCost.toDecimalPlaces(2);
  const profit = totalRevenue.minus(totalCost);
  const profitMarginPct = totalRevenue.greaterThan(0)
    ? profit.dividedBy(totalRevenue).times(100).toDecimalPlaces(2)
    : new Decimal(0);

  return { unitsSold, totalRevenue, totalCost, profit, profitMarginPct };
}

async function getStockAlerts() {
  // Top 5 nada más — el Dashboard es un vistazo, no el listado completo (ese
  // ya existe en GET /inventory/stock-summary?belowMinStock=true, adonde
  // apunta el "ver todos" del widget en el frontend).
  const summary = await getStockSummary({ page: 1, pageSize: 5, belowMinStock: true });
  return {
    count: summary.pagination.total,
    items: summary.data.map((row) => ({
      variantId: row.variantId,
      sku: row.sku,
      label: row.label,
      productName: row.product.name,
      stock: row.stock,
      minStock: row.minStock,
    })),
  };
}

export async function getDashboardSummary(role: Role) {
  const now = new Date();
  const todayStart = startOfUTCDay(now);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000); // últimos 7 días corridos.
  const monthStart = startOfUTCMonth(now); // mes calendario en curso.

  const [stockAlerts, pendingCourierCount] = await Promise.all([
    getStockAlerts(),
    // "Pendiente de confirmación de courier" = envío contra entrega que
    // todavía no volvió con un resultado (entregado/rechazado/perdido/dañado).
    prisma.shipment.count({ where: { status: ShipmentStatus.EN_TRANSITO } }),
  ]);
  const pendingCourierShipments = { count: pendingCourierCount };

  if (!hasAdminAccess(role)) {
    const [today, week, month] = await Promise.all([
      getSalesRevenueOnly(todayStart, now),
      getSalesRevenueOnly(weekStart, now),
      getSalesRevenueOnly(monthStart, now),
    ]);
    return { stockAlerts, pendingCourierShipments, sales: { today, week, month } };
  }

  const [today, week, month, accountsReceivable, insuranceClaimsPendingCount, consignmentOverdueCount] = await Promise.all([
    getSalesWithCost(todayStart, now),
    getSalesWithCost(weekStart, now),
    getSalesWithCost(monthStart, now),
    getAccountsReceivableSummary(),
    prisma.insuranceClaim.count({ where: { status: { in: OPEN_STATUSES } } }),
    countOverdueReviews(),
  ]);

  return {
    stockAlerts,
    pendingCourierShipments,
    sales: { today, week, month },
    accountsReceivable,
    insuranceClaims: { pendingCount: insuranceClaimsPendingCount },
    // Alerta de consignación: lotes con revisión vencida (solo ADMIN/CEO).
    consignment: { overdueReviewCount: consignmentOverdueCount },
  };
}
