import { Prisma } from "@prisma/client";
import { randomInt } from "crypto";

export interface FiscalLine {
  itemId: string; code: string; description: string; quantity: number; unitPrice: string; ivaCode: string; ivaRate: string;
}
export interface FiscalSnapshot {
  issuer: { ruc: string; legalName: string; tradeName?: string | null; address: string; accountingRequired: boolean; specialTaxpayer?: string | null; withholdingAgent?: string | null; regime: string };
  establishment: string; emissionPoint: string; establishmentAddress: string;
  buyer: { name: string; identification: string; identificationType: string; address: string; email?: string | null };
  lines: FiscalLine[]; paymentCode: string; creditDays: number;
  reason?: string; originalNumber?: string; originalDate?: string;
  transport?: { startDate: string; endDate: string; origin: string; destination: string; carrierName: string; carrierId: string; carrierIdType: string; plate: string; reason: string };
}
export const escapeXml = (value: unknown) => String(value ?? "").replace(/[<>&"']/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
const tag = (name: string, value: unknown) => `<${name}>${escapeXml(value)}</${name}>`;
const optional = (name: string, value: unknown) => value ? tag(name, value) : "";
export function fiscalDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Guayaquil", day: "2-digit", month: "2-digit", year: "numeric" }).formatToParts(date);
  return ["day", "month", "year"].map(type => parts.find(p => p.type === type)!.value).join("/");
}
export function accessKey(date: Date, type: string, ruc: string, environment: string, establishment: string, point: string, number: number, numeric = randomInt(100000000).toString().padStart(8, "0")) {
  const base = fiscalDate(date).replace(/\//g, "") + type + ruc + environment + establishment + point + String(number).padStart(9, "0") + numeric + "1";
  if (!/^\d{48}$/.test(base)) throw new Error("Datos inválidos para la clave de acceso");
  let sum = 0;
  [...base].reverse().forEach((digit, i) => { sum += Number(digit) * (2 + i % 6); });
  const check = 11 - sum % 11;
  return base + (check === 11 ? 0 : check === 10 ? 1 : check);
}
// Error 52 (diferencias): each detail and each totalImpuesto must equal base × tarifa rounded to 2 decimals.
// The group IVA is computed from the group base, not by summing rounded line values.
export function totals(lines: FiscalLine[]) {
  let subtotal = new Prisma.Decimal(0);
  const groups = new Map<string, { code: string; rate: string; base: Prisma.Decimal; value: Prisma.Decimal }>();
  const details = lines.map(line => {
    const base = new Prisma.Decimal(line.unitPrice).times(line.quantity).toDecimalPlaces(2);
    const value = base.times(line.ivaRate).div(100).toDecimalPlaces(2);
    subtotal = subtotal.plus(base);
    const key = `${line.ivaCode}:${line.ivaRate}`;
    const group = groups.get(key) ?? { code: line.ivaCode, rate: line.ivaRate, base: new Prisma.Decimal(0), value: new Prisma.Decimal(0) };
    group.base = group.base.plus(base); groups.set(key, group);
    return { ...line, base, value };
  });
  let tax = new Prisma.Decimal(0);
  for (const group of groups.values()) { group.value = group.base.times(group.rate).div(100).toDecimalPlaces(2); tax = tax.plus(group.value); }
  return { subtotal, tax, total: subtotal.plus(tax), groups: [...groups.values()], details };
}
export function buildXml(s: FiscalSnapshot, type: string, environment: string, date: Date, number: string, key: string) {
  const issuer = s.issuer, t = totals(s.lines), buyer = s.buyer;
  const root = type === "01" ? "factura" : type === "04" ? "notaCredito" : "guiaRemision";
  const info = `<infoTributaria>${tag("ambiente", environment)}${tag("tipoEmision", "1")}${tag("razonSocial", issuer.legalName)}${optional("nombreComercial", issuer.tradeName)}${tag("ruc", issuer.ruc)}${tag("claveAcceso", key)}${tag("codDoc", type)}${tag("estab", s.establishment)}${tag("ptoEmi", s.emissionPoint)}${tag("secuencial", number.split("-")[2])}${tag("dirMatriz", issuer.address)}${optional("agenteRetencion", issuer.withholdingAgent)}${issuer.regime === "GENERAL" ? "" : tag("contribuyenteRimpe", issuer.regime === "RIMPE_POPULAR" ? "CONTRIBUYENTE NEGOCIO POPULAR - RÉGIMEN RIMPE" : "CONTRIBUYENTE RÉGIMEN RIMPE")}</infoTributaria>`;
  const totalTaxes = `<totalConImpuestos>${t.groups.map(g => `<totalImpuesto>${tag("codigo", "2")}${tag("codigoPorcentaje", g.code)}${tag("baseImponible", g.base.toFixed(2))}${tag("valor", g.value.toFixed(2))}</totalImpuesto>`).join("")}</totalConImpuestos>`;
  const identification = tag("tipoIdentificacionComprador", buyer.identificationType) + tag("razonSocialComprador", buyer.name) + tag("identificacionComprador", buyer.identification);
  const accounting = optional("contribuyenteEspecial", issuer.specialTaxpayer) + tag("obligadoContabilidad", issuer.accountingRequired ? "SI" : "NO");
  const dateAndAddress = tag("fechaEmision", fiscalDate(date)) + tag("dirEstablecimiento", s.establishmentAddress);
  let body: string;
  if (type === "06") {
    const tr = s.transport!;
    body = `<infoGuiaRemision>${tag("dirEstablecimiento", s.establishmentAddress)}${tag("dirPartida", tr.origin)}${tag("razonSocialTransportista", tr.carrierName)}${tag("tipoIdentificacionTransportista", tr.carrierIdType)}${tag("rucTransportista", tr.carrierId)}${tag("obligadoContabilidad", issuer.accountingRequired ? "SI" : "NO")}${optional("contribuyenteEspecial", issuer.specialTaxpayer)}${tag("fechaIniTransporte", tr.startDate)}${tag("fechaFinTransporte", tr.endDate)}${tag("placa", tr.plate)}</infoGuiaRemision><destinatarios><destinatario>${tag("identificacionDestinatario", buyer.identification)}${tag("razonSocialDestinatario", buyer.name)}${tag("dirDestinatario", tr.destination)}${tag("motivoTraslado", tr.reason)}<detalles>${s.lines.map(l => `<detalle>${tag("codigoInterno", l.code)}${tag("descripcion", l.description)}${tag("cantidad", l.quantity)}</detalle>`).join("")}</detalles></destinatario></destinatarios>`;
  } else {
    body = type === "01"
      ? `<infoFactura>${dateAndAddress}${accounting}${identification}${optional("direccionComprador", buyer.address)}${tag("totalSinImpuestos", t.subtotal.toFixed(2))}${tag("totalDescuento", "0.00")}${totalTaxes}${tag("propina", "0.00")}${tag("importeTotal", t.total.toFixed(2))}${tag("moneda", "DOLAR")}<pagos><pago>${tag("formaPago", s.paymentCode)}${tag("total", t.total.toFixed(2))}${s.creditDays ? tag("plazo", s.creditDays) + tag("unidadTiempo", "dias") : ""}</pago></pagos></infoFactura>`
      : `<infoNotaCredito>${dateAndAddress}${identification}${accounting}${tag("codDocModificado", "01")}${tag("numDocModificado", s.originalNumber)}${tag("fechaEmisionDocSustento", s.originalDate)}${tag("totalSinImpuestos", t.subtotal.toFixed(2))}${tag("valorModificacion", t.total.toFixed(2))}${tag("moneda", "DOLAR")}${totalTaxes}${tag("motivo", s.reason)}</infoNotaCredito>`;
    body += `<detalles>${t.details.map(l => `<detalle>${tag(type === "01" ? "codigoPrincipal" : "codigoInterno", l.code)}${tag("descripcion", l.description)}${tag("cantidad", l.quantity)}${tag("precioUnitario", l.unitPrice)}${tag("descuento", "0.00")}${tag("precioTotalSinImpuesto", l.base.toFixed(2))}<impuestos><impuesto>${tag("codigo", "2")}${tag("codigoPorcentaje", l.ivaCode)}${tag("tarifa", l.ivaRate)}${tag("baseImponible", l.base.toFixed(2))}${tag("valor", l.value.toFixed(2))}</impuesto></impuestos></detalle>`).join("")}</detalles>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?><${root} id="comprobante" version="1.1.0">${info}${body}${buyer.email ? `<infoAdicional><campoAdicional nombre="Email">${escapeXml(buyer.email)}</campoAdicional></infoAdicional>` : ""}</${root}>`;
}
