// Reporte de rentabilidad: SIEMPRE lee costos ya congelados en
// DispatchOrderItem (unitCostSnapshot, landedCostSnapshot), nunca los
// recalcula en vivo. Esa es la garantía central del módulo: dos corridas del
// mismo reporte, sobre el mismo rango de fechas, deben dar siempre el mismo
// número, sin importar qué pase con costos o compras posteriores.
// landedCostSnapshot (cuando existe) YA es el costo de aterrizaje completo
// -fábrica + flete/aduana prorrateado-, no un extra que se suma a
// unitCostSnapshot. Es null en órdenes confirmadas antes de que el campo
// existiera; para esas, el costo usado es solo unitCostSnapshot (el "extra"
// de flete/aduana se trata como 0), en vez de romper el reporte o intentar
// "rellenarlo" con un cálculo en vivo.
import { DispatchStatus, Prisma } from "@prisma/client";
import { classifySaleByShipment } from "../../lib/dispatchSaleClassification";
import { prisma } from "../../lib/prisma";

const { Decimal } = Prisma;

interface ProfitabilityQuery {
  dateFrom?: Date;
  dateTo?: Date;
  categoryId?: string;
  variantId?: string;
}

// dateTo llega parseado por profitabilityQuerySchema (z.coerce.date()) sobre
// un string tipo "2026-09-18" — eso da medianoche UTC de ese día. Usarlo tal
// cual en un `lte` excluiría TODO lo despachado ese mismo día (cualquier
// hora después de las 00:00 UTC queda afuera) — un reporte con
// dateTo=hoy nunca mostraría las ventas de hoy. Se corre al final del día
// para que "hasta hoy" incluya de verdad las ventas de hoy.
function endOfDay(date: Date): Date {
  return new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1);
}

interface ProfitLine {
  buyerId: string;
  buyerType: string;
  buyerName: string;
  variantId: string;
  sku: string;
  label: string | null;
  productId: string;
  productName: string;
  categoryId: string;
  categoryName: string;
  unitsSold: number;
  totalRevenue: Prisma.Decimal;
  totalCost: Prisma.Decimal;
}

type Totals = Pick<ProfitLine, "unitsSold" | "totalRevenue" | "totalCost">;

function profitOf(totals: Totals) {
  return totals.totalRevenue.minus(totals.totalCost);
}

function marginPctOf(totals: Totals) {
  return totals.totalRevenue.greaterThan(0)
    ? profitOf(totals).dividedBy(totals.totalRevenue).times(100).toDecimalPlaces(2)
    : new Decimal(0);
}

function toTotalsOutput(totals: Totals) {
  return {
    unitsSold: totals.unitsSold,
    totalRevenue: totals.totalRevenue.toDecimalPlaces(2),
    totalCost: totals.totalCost.toDecimalPlaces(2),
    profit: profitOf(totals).toDecimalPlaces(2),
    profitMarginPct: marginPctOf(totals),
  };
}

function toLineOutput(line: ProfitLine) {
  return {
    variantId: line.variantId,
    sku: line.sku,
    label: line.label,
    productId: line.productId,
    productName: line.productName,
    categoryId: line.categoryId,
    ...toTotalsOutput(line),
  };
}

function sumTotals(lines: Totals[]): Totals {
  return lines.reduce(
    (acc, l) => ({
      unitsSold: acc.unitsSold + l.unitsSold,
      totalRevenue: acc.totalRevenue.plus(l.totalRevenue),
      totalCost: acc.totalCost.plus(l.totalCost),
    }),
    { unitsSold: 0, totalRevenue: new Decimal(0), totalCost: new Decimal(0) }
  );
}

function groupByVariant(lines: ProfitLine[]): ProfitLine[] {
  const map = new Map<string, ProfitLine>();
  for (const line of lines) {
    const existing = map.get(line.variantId);
    if (existing) {
      existing.unitsSold += line.unitsSold;
      existing.totalRevenue = existing.totalRevenue.plus(line.totalRevenue);
      existing.totalCost = existing.totalCost.plus(line.totalCost);
    } else {
      map.set(line.variantId, { ...line });
    }
  }
  return [...map.values()];
}

// Trae los DispatchOrderItem del rango/filtros pedidos y los separa en dos
// baldes:
// - sold: venta concretada, cuenta para el reporte principal.
// - pendingClaim: el Shipment terminó PERDIDO/DANADO y el InsuranceClaim
//   todavía no está PAGADO — no se mezcla con ventas normales hasta que se
//   resuelva.
// Los Shipment RECHAZADO se excluyen del todo: el producto volvió a bodega,
// no hubo venta.
async function fetchClassifiedItems(
  query: ProfitabilityQuery
): Promise<{ sold: ProfitLine[]; pendingClaim: ProfitLine[] }> {
  const items = await prisma.dispatchOrderItem.findMany({
    where: {
      variantId: query.variantId,
      variant: query.categoryId ? { product: { categoryId: query.categoryId } } : undefined,
      dispatchOrder: {
        deletedAt: null,
        status: DispatchStatus.DESPACHADO,
        dispatchDate: {
          gte: query.dateFrom,
          lte: query.dateTo ? endOfDay(query.dateTo) : undefined,
        },
      },
    },
    include: {
      dispatchOrder: { include: { wholesaler: true, finalCustomer: true, shipment: { include: { claim: true } } } },
      variant: { include: { product: { include: { category: true } } } },
    },
  });

  const sold: ProfitLine[] = [];
  const pendingClaim: ProfitLine[] = [];

  for (const item of items) {
    const shipment = item.dispatchOrder.shipment;
    const classification = classifySaleByShipment(shipment);
    if (classification === "EXCLUDED") continue;

    // totalRevenue = Σ(unitPrice × quantity). unitPrice ya viene NETO (con
    // descuento aplicado, según la definición original del campo) — NO se
    // vuelve a aplicar discountPct, sería descontar dos veces.
    const totalRevenue = item.unitPrice.times(item.quantity);
    // landedCostSnapshot (vía computeLandedCost) ya es el costo de aterrizaje
    // COMPLETO (fábrica + flete/aduana prorrateado), no un extra que se suma
    // a unitCostSnapshot — sumarlos duplicaría el costo de fábrica. Solo cae
    // a unitCostSnapshot cuando landedCostSnapshot es null (orden confirmada
    // antes de que el campo existiera): ahí el "extra" de flete/aduana se
    // trata como 0, no como que el costo total sea 0.
    const unitCost = item.landedCostSnapshot ?? item.unitCostSnapshot ?? new Decimal(0);
    const totalCost = unitCost.times(item.quantity);

    const line: ProfitLine = {
      buyerId: (item.dispatchOrder.wholesalerId ?? item.dispatchOrder.finalCustomerId)!,
      buyerType: item.dispatchOrder.buyerType,
      buyerName: item.dispatchOrder.wholesaler?.businessName ?? item.dispatchOrder.finalCustomer?.fullName ?? "Cliente",
      variantId: item.variantId,
      sku: item.variant.sku,
      label: item.variant.label,
      productId: item.variant.productId,
      productName: item.variant.product.name,
      categoryId: item.variant.product.categoryId,
      categoryName: item.variant.product.category.name,
      unitsSold: item.quantity,
      totalRevenue,
      totalCost,
    };

    if (classification === "PENDING_CLAIM") {
      pendingClaim.push(line);
    } else {
      sold.push(line);
    }
  }

  return { sold, pendingClaim };
}

export async function getProfitabilityReport(query: ProfitabilityQuery) {
  const { sold, pendingClaim } = await fetchClassifiedItems(query);
  const groupedSold = groupByVariant(sold);
  const groupedPending = groupByVariant(pendingClaim);

  return {
    filters: {
      dateFrom: query.dateFrom?.toISOString() ?? null,
      dateTo: query.dateTo?.toISOString() ?? null,
      categoryId: query.categoryId ?? null,
      variantId: query.variantId ?? null,
    },
    lines: groupedSold.map(toLineOutput),
    totals: toTotalsOutput(sumTotals(groupedSold)),
    ventasConReclamoPendiente: {
      lines: groupedPending.map(toLineOutput),
      totals: toTotalsOutput(sumTotals(groupedPending)),
    },
  };
}

function buyerTotals(lines: ProfitLine[]) {
  const groups = new Map<string, ProfitLine[]>();
  for (const line of lines) {
    const key = line.buyerType + ":" + line.buyerId;
    groups.set(key, [...(groups.get(key) ?? []), line]);
  }
  return [...groups.values()].map(rows => ({
    buyerId: rows[0].buyerId, buyerType: rows[0].buyerType, buyerName: rows[0].buyerName,
    ...toTotalsOutput(sumTotals(rows)),
  })).sort((a, b) => b.profit.comparedTo(a.profit));
}

export async function getProfitabilitySummary(query: ProfitabilityQuery) {
  const { sold } = await fetchClassifiedItems(query);
  const grouped = groupByVariant(sold);

  const byCategory = new Map<string, { categoryId: string; categoryName: string; lines: ProfitLine[] }>();
  for (const line of grouped) {
    const bucket = byCategory.get(line.categoryId);
    if (bucket) {
      bucket.lines.push(line);
    } else {
      byCategory.set(line.categoryId, { categoryId: line.categoryId, categoryName: line.categoryName, lines: [line] });
    }
  }

  const topProductsByProfit = [...grouped]
    .sort((a, b) => profitOf(b).comparedTo(profitOf(a)))
    .slice(0, 10)
    .map((line) => ({
      variantId: line.variantId,
      sku: line.sku,
      label: line.label,
      productName: line.productName,
      unitsSold: line.unitsSold,
      totalRevenue: line.totalRevenue.toDecimalPlaces(2),
      profit: profitOf(line).toDecimalPlaces(2),
    }));

  return {
    period: {
      dateFrom: query.dateFrom?.toISOString() ?? null,
      dateTo: query.dateTo?.toISOString() ?? null,
    },
    totals: toTotalsOutput(sumTotals(grouped)),
    byBuyer: buyerTotals(sold),
    byCategory: [...byCategory.values()]
      .map(({ categoryId, categoryName, lines }) => ({
        categoryId,
        categoryName,
        ...toTotalsOutput(sumTotals(lines)),
      }))
      .sort((a, b) => b.profit.comparedTo(a.profit)),
    topProductsByProfit,
  };
}
