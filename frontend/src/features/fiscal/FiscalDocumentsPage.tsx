import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Field, inputClass, types, states, emailStates, date, money, useSettings } from "./shared";

export function FiscalDocumentsPage() {
  const [params] = useSearchParams(); const settings = useSettings();
  const [filters, setFilters] = useState({ q: "", issuerId: "", environment: "", type: "", status: "", from: "", to: "", page: 1 });
  const search = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => { if (value) search.set(key, String(value)); });
  if (params.get("orderId")) search.set("orderId", params.get("orderId")!);
  const query = useQuery({ queryKey: ["fiscal", "documents", search.toString()], queryFn: () => apiFetch<{ data: { id: string; number: string | null; issuer: { legalName: string }; documentType: string; environment: string; status: string; cancellationStatus: string; buyerName: string; total: string; issueDate: string; dispatchOrder?: { id: string; orderNumber: string }; deliveries: { status: string }[] }[]; total: number }>(`/fiscal-documents?${search}`), refetchInterval: 10000 });
  const change = (key: string, value: string) => setFilters({ ...filters, [key]: value, page: 1 });
  return <div className="space-y-5"><div><h1 className="text-2xl font-semibold">Comprobantes electrónicos</h1><p className="text-sm text-muted-foreground">Facturas, notas de crédito y guías vinculadas a tus despachos.</p></div>
    {params.get("orderId") && <p className="text-sm">Mostrando un despacho. <Link to="/billing" className="underline">Ver todos</Link></p>}
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Buscar"><input className={inputClass} placeholder="Cliente, identificación, número o despacho" value={filters.q} onChange={e => change("q", e.target.value)} /></Field>
      <Field label="Empresa"><select className={inputClass} value={filters.issuerId} onChange={e => change("issuerId", e.target.value)}><option value="">Todas</option>{settings.data?.issuers.map(i => <option key={i.id} value={i.id}>{i.legalName}</option>)}</select></Field>
      <Field label="Ambiente"><select className={inputClass} value={filters.environment} onChange={e => change("environment", e.target.value)}><option value="">Todos</option><option value="1">Pruebas</option><option value="2">Producción</option></select></Field>
      <Field label="Tipo"><select className={inputClass} value={filters.type} onChange={e => change("type", e.target.value)}><option value="">Todos</option>{Object.entries(types).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <Field label="Estado"><select className={inputClass} value={filters.status} onChange={e => change("status", e.target.value)}><option value="">Todos</option>{Object.entries(states).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <Field label="Desde"><input className={inputClass} type="date" value={filters.from} onChange={e => change("from", e.target.value)} /></Field><Field label="Hasta"><input className={inputClass} type="date" value={filters.to} onChange={e => change("to", e.target.value)} /></Field>
    </div>
    {query.error && <p role="alert">{query.error.message}</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b">{["Fecha / empresa", "Comprobante", "Comprador", "Total", "Estado", "Correo", "Despacho"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{query.data?.data.map(d => <tr key={d.id} className="border-b"><td className="p-2">{date(d.issueDate)}<p className="text-xs text-muted-foreground">{d.issuer.legalName}</p></td><td className="p-2"><Link className="underline" to={`/billing/${d.id}`}>{types[d.documentType]} · {d.number ?? "Borrador"}</Link><p className="text-xs">{d.environment === "1" ? "Pruebas" : "Producción"}</p></td><td className="p-2">{d.buyerName}</td><td className="p-2">{d.documentType === "06" ? "—" : money(d.total)}</td><td className="p-2">{d.cancellationStatus === "CONFIRMED" ? "Anulado" : states[d.status]}{d.cancellationStatus === "REQUESTED" && <p className="text-xs">Anulación solicitada</p>}</td><td className="p-2">{emailStates[d.deliveries[0]?.status] ?? "Sin enviar"}</td><td className="p-2">{d.dispatchOrder && <Link className="underline" to={`/dispatch-orders/${d.dispatchOrder.id}`}>{d.dispatchOrder.orderNumber}</Link>}</td></tr>)}</tbody></table></div>
    {query.isLoading ? <p>Cargando…</p> : !query.data?.data.length && !query.error ? <p className="text-sm text-muted-foreground">No hay comprobantes con estos filtros. Los nuevos despachos con emisor configurado generarán borradores en el momento de la venta.</p> : null}
    <div className="flex items-center justify-between text-sm"><span>{query.data?.total ?? 0} comprobantes · Página {filters.page}</span><div className="flex gap-2"><Button variant="outline" disabled={filters.page <= 1} onClick={() => setFilters({ ...filters, page: filters.page - 1 })}>Anterior</Button><Button variant="outline" disabled={filters.page * 30 >= (query.data?.total ?? 0)} onClick={() => setFilters({ ...filters, page: filters.page + 1 })}>Siguiente</Button></div></div>
  </div>;
}
