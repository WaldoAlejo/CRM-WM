import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { Field, inputClass, useAction, useSettings, date, types, type Issuer, type Settings } from "./shared";

function IssuerForm({ issuer, settings, onDone }: { issuer?: Issuer; settings: Settings; onDone(): void }) {
  const action = useAction();
  const [form, setForm] = useState({ ruc: issuer?.ruc ?? "", legalName: issuer?.legalName ?? "", tradeName: issuer?.tradeName ?? "", address: issuer?.address ?? "", accountingRequired: issuer?.accountingRequired ?? false, specialTaxpayer: issuer?.specialTaxpayer ?? "", withholdingAgent: issuer?.withholdingAgent ?? "", regime: issuer?.regime ?? "GENERAL", environment: issuer?.environment ?? "1", mailProfileId: issuer?.mailProfileId ?? null });
  return <form className="space-y-4 rounded-md border p-5" onSubmit={e => { e.preventDefault(); action.mutate({ path: `/settings/issuers${issuer ? `/${issuer.id}` : ""}`, method: issuer ? "PUT" : "POST", data: form }, { onSuccess: onDone }); }}>
    <h2 className="font-semibold">{issuer ? "Editar datos fiscales" : "Nueva empresa emisora"}</h2>
    <div className="grid gap-4 md:grid-cols-2">{([["ruc", "RUC"], ["legalName", "Razón social"], ["tradeName", "Nombre comercial (opcional)"], ["address", "Dirección matriz"], ["specialTaxpayer", "Contribuyente especial: n.º de resolución, solo dígitos (si aplica)"], ["withholdingAgent", "Agente de retención: n.º de resolución sin ceros a la izquierda (si aplica)"]] as const).map(([key, label]) => <Field key={key} label={label}><input className={inputClass} value={form[key]} required={["ruc", "legalName", "address"].includes(key)} disabled={key === "ruc" && !!issuer} maxLength={key === "ruc" ? 13 : 300} onChange={e => setForm({ ...form, [key]: e.target.value })} /></Field>)}
      <Field label="Régimen"><select className={inputClass} value={form.regime} onChange={e => setForm({ ...form, regime: e.target.value })}><option value="GENERAL">General</option><option value="RIMPE_EMPRENDEDOR">RIMPE emprendedor</option><option value="RIMPE_POPULAR" disabled>RIMPE negocio popular (no admitido por los XSD del SRI)</option></select></Field>
      <Field label="Ambiente"><select className={inputClass} value={form.environment} onChange={e => setForm({ ...form, environment: e.target.value })}><option value="1">Pruebas · sin validez tributaria</option><option value="2" disabled={!settings.productionEnabled}>Producción</option></select></Field>
      <Field label="Correo para comprobantes de esta empresa"><select className={inputClass} value={form.mailProfileId ?? ""} onChange={e => setForm({ ...form, mailProfileId: e.target.value || null })}><option value="">Sin asignar</option>{settings.mailProfiles.map(p => <option key={p.id} value={p.id}>{p.name} · {p.fromEmail}</option>)}</select></Field>
    </div>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.accountingRequired} onChange={e => setForm({ ...form, accountingRequired: e.target.checked })} />Obligado a llevar contabilidad</label>
    {issuer && <p className="text-sm text-muted-foreground">Guardar estos datos pausa la emisión hasta volver a validar y activar la empresa.</p>}
    <div className="flex flex-wrap gap-2"><Button disabled={action.isPending}>Guardar datos</Button><Button type="button" variant="outline" onClick={onDone}>Cerrar</Button></div>
  </form>;
}
function SeriesRow({ issuerId, series }: { issuerId: string; series: Issuer["series"][number] }) {
  const action = useAction(); const [open, setOpen] = useState(false); const [lastNumber, setLastNumber] = useState(series.lastNumber + 1);
  return <div className="space-y-2 text-sm"><div className="flex flex-wrap items-center gap-2"><span>{types[series.documentType]} · {series.environment === "1" ? "Pruebas" : "Producción"} · {series.establishment}-{series.emissionPoint} · Último número: {String(series.lastNumber).padStart(9, "0")}</span><Button type="button" size="sm" variant="ghost" onClick={() => setOpen(!open)}>Avanzar numeración</Button></div>
    {open && <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); action.mutate({ path: `/settings/issuers/${issuerId}/series/${series.id}/advance`, data: { lastNumber } }, { onSuccess: () => setOpen(false) }); }}><Field label="Último número ya emitido fuera de la aplicación"><input className={inputClass} type="number" min={series.lastNumber + 1} max={999999998} value={lastNumber} onChange={e => setLastNumber(Number(e.target.value))} /></Field><Button size="sm" disabled={action.isPending || lastNumber <= series.lastNumber}>Confirmar</Button><p className="basis-full text-xs text-muted-foreground">Úsalo si el SRI rechaza con «secuencial registrado» (error 45). La numeración solo avanza; no puede retroceder.</p></form>}
  </div>;
}
function IssuerDetails({ issuer, active }: { issuer: Issuer; active: boolean }) {
  const action = useAction();
  const [file, setFile] = useState<File | null>(null), [password, setPassword] = useState("");
  const [representative, setRepresentative] = useState(false), [verified, setVerified] = useState(false);
  const [series, setSeries] = useState({ environment: issuer.environment, documentType: "01", establishment: "001", emissionPoint: "001", address: issuer.address, lastNumber: 0 });
  const certificate = issuer.certificates.find(c => !c.retiredAt);
  const days = certificate ? Math.ceil((new Date(certificate.validTo).getTime() - Date.now()) / 86400000) : null;
  return <div className="space-y-5 rounded-md border p-5">
    <div><h2 className="font-semibold">{issuer.legalName} · {issuer.ruc}</h2><p className="text-sm">{active ? "Empresa seleccionada" : "Empresa no activa"} · {issuer.environment === "1" ? "Pruebas" : "Producción"} · {issuer.enabledForEmission ? "Configuración validada" : "Pendiente de validación"}</p></div>
    <section className="space-y-3"><h3 className="font-medium">Firma electrónica</h3>
      {certificate ? <div className="rounded-md bg-muted p-3 text-sm"><p>{certificate.subject}</p><p>Emitida por: {certificate.issuedBy}</p><p>Vigencia: {date(certificate.validFrom)} — {date(certificate.validTo)}</p>{days !== null && days <= 30 && <p role="alert">{days <= 0 ? "Firma vencida. Debe reemplazarse." : `La firma vence en ${days} días.`}</p>}</div> : <p className="text-sm text-muted-foreground">Todavía no hay una firma cargada.</p>}
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (!file) return; const data = new FormData(); data.append("certificate", file); data.append("password", password); data.append("confirmedRepresentative", String(representative)); action.mutate({ path: `/settings/issuers/${issuer.id}/certificate`, data }, { onSuccess: () => { setPassword(""); setFile(null); setRepresentative(false); } }); }}>
        <div className="grid gap-4 md:grid-cols-2"><Field label="Archivo P12 o PFX (máximo 1 MB)"><input type="file" accept=".p12,.pfx" required onChange={e => setFile(e.target.files?.[0] ?? null)} /></Field><Field label="Contraseña de la firma"><input className={inputClass} type="password" autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} /></Field></div>
        <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={representative} onChange={e => setRepresentative(e.target.checked)} />Confirmo que el titular de esta firma está habilitado para representar a esta empresa.</label>
        <Button disabled={action.isPending || !file || !representative}>{certificate ? "Validar y reemplazar firma" : "Validar y guardar firma"}</Button>
      </form>
      {issuer.certificates.some(c => c.retiredAt) && <details className="text-sm"><summary>Historial de firmas reemplazadas</summary>{issuer.certificates.filter(c => c.retiredAt).map(c => <p key={c.id}>{c.subject} · Reemplazada: {date(c.retiredAt!)} · Serie: {c.serialNumber}</p>)}</details>}
    </section>
    <section className="space-y-3 border-t pt-4"><h3 className="font-medium">Series y numeración</h3>
      {issuer.series.map(s => <SeriesRow key={s.id} issuerId={issuer.id} series={s} />)}
      <form className="space-y-3" onSubmit={e => { e.preventDefault(); action.mutate({ path: `/settings/issuers/${issuer.id}/series`, data: series }); }}>
        <div className="grid gap-3 md:grid-cols-3"><Field label="Tipo"><select className={inputClass} value={series.documentType} onChange={e => setSeries({ ...series, documentType: e.target.value })}>{Object.entries(types).map(([v, label]) => <option value={v} key={v}>{label}</option>)}</select></Field><Field label="Ambiente"><select className={inputClass} value={series.environment} onChange={e => setSeries({ ...series, environment: e.target.value })}><option value="1">Pruebas</option><option value="2">Producción</option></select></Field>
          {([["establishment", "Establecimiento (3 dígitos)"], ["emissionPoint", "Punto de emisión (3 dígitos)"], ["address", "Dirección del establecimiento"]] as const).map(([key, label]) => <Field key={key} label={label}><input required className={inputClass} value={series[key]} onChange={e => setSeries({ ...series, [key]: e.target.value })} /></Field>)}
          <Field label="Último número emitido (0 si no se ha usado)"><input className={inputClass} type="number" min={0} max={999999998} value={series.lastNumber} onChange={e => setSeries({ ...series, lastNumber: Number(e.target.value) })} /></Field>
        </div><Button variant="outline" disabled={action.isPending}>Agregar serie</Button>
      </form>
    </section>
    <section className="space-y-3 border-t pt-4"><label className="flex gap-2 text-sm"><input type="checkbox" checked={verified} onChange={e => setVerified(e.target.checked)} />Verifiqué los datos fiscales y la habilitación de este emisor en el SRI.</label><p className="text-sm text-muted-foreground">Al activar esta empresa, se utilizará para nuevos despachos. Los anteriores conservarán su emisor.</p><Button disabled={!verified || action.isPending} onClick={() => action.mutate({ path: `/settings/issuers/${issuer.id}/activate`, data: { verified } })}>{active ? "Validar y habilitar emisión" : "Activar esta empresa"}</Button></section>
  </div>;
}
const taxOptions = [{ code: "0", rate: 0, label: "IVA 0%" }, { code: "10", rate: 13, label: "IVA 13%" }, { code: "4", rate: 15, label: "IVA 15%" }, { code: "2", rate: 12, label: "IVA 12%" }, { code: "3", rate: 14, label: "IVA 14%" }, { code: "5", rate: 5, label: "IVA 5%" }, { code: "8", rate: 8, label: "IVA 8%" }, { code: "6", rate: 0, label: "No objeto de IVA" }, { code: "7", rate: 0, label: "Exento de IVA" }];
function TaxProducts() {
  const [q, setQ] = useState(""); const action = useAction();
  const query = useQuery({ queryKey: ["fiscal", "tax-products", q], queryFn: () => apiFetch<{ id: string; name: string; sku: string; ivaCode: string | null }[]>(`/fiscal-documents/tax-products?q=${encodeURIComponent(q)}`) });
  return <section className="space-y-3 rounded-md border p-5"><h2 className="font-semibold">IVA por producto</h2><p className="text-sm text-muted-foreground">Los precios son sin IVA. Selecciona la tarifa aplicable a nuevas órdenes; los despachos existentes conservarán sus impuestos. Se muestran hasta 100 resultados.</p><input className={inputClass} aria-label="Buscar producto para IVA" placeholder="Buscar por nombre o SKU" value={q} onChange={e => setQ(e.target.value)} />{query.error && <p role="alert">{query.error.message}</p>}<div className="max-h-80 space-y-2 overflow-y-auto">{query.data?.map(p => <div key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm"><span className="min-w-0 flex-1 basis-48">{p.sku} · {p.name}</span><select aria-label={`IVA de ${p.name}`} className={`${inputClass} max-w-48`} value={p.ivaCode ?? ""} disabled={action.isPending} onChange={e => { const tax = taxOptions.find(t => t.code === e.target.value)!; action.mutate({ path: `/fiscal-documents/tax-products/${p.id}`, method: "PUT", data: { ivaCode: tax.code, ivaRate: tax.rate } }); }}><option value="" disabled>Sin configurar</option>{taxOptions.map(t => <option value={t.code} key={t.code}>{t.label}</option>)}</select></div>)}</div></section>;
}
export function FiscalSettingsPage() {
  const query = useSettings(); const [editing, setEditing] = useState<Issuer | "new" | null>(null); const [selected, setSelected] = useState("");
  if (query.isLoading) return <p>Cargando configuración…</p>;
  if (query.error || !query.data) return <p role="alert">{query.error?.message ?? "No se pudo cargar"}</p>;
  const settings = query.data, issuer = settings.issuers.find(i => i.id === (selected || settings.settings?.activeIssuerId)) ?? settings.issuers[0];
  return <div className="space-y-5"><div className="flex flex-wrap justify-between gap-3"><div><h1 className="text-2xl font-semibold">Facturación electrónica</h1><p className="text-sm text-muted-foreground">Una empresa activa, con historial independiente por RUC.</p></div><Button onClick={() => setEditing("new")}>Nueva empresa</Button></div>
    {!settings.encryptionReady && <p role="alert" className="rounded-md border p-3 text-sm">Configura la clave de cifrado del servidor para proteger la firma y las contraseñas.</p>}
    {!settings.productionEnabled && <p className="rounded-md bg-muted p-3 text-sm">La emisión de producción está desactivada. Puedes configurar y validar el circuito en pruebas.</p>}
    {editing && <IssuerForm key={editing === "new" ? "new" : editing.id} issuer={editing === "new" ? undefined : editing} settings={settings} onDone={() => setEditing(null)} />}
    {issuer ? <><div className="flex flex-wrap gap-3"><select aria-label="Empresa emisora" className={inputClass} value={issuer.id} onChange={e => setSelected(e.target.value)}>{settings.issuers.map(i => <option key={i.id} value={i.id}>{i.legalName} · {i.ruc}{settings.settings?.activeIssuerId === i.id ? " · Activa" : ""}</option>)}</select><Button variant="outline" onClick={() => setEditing(issuer)}>Editar datos</Button></div><IssuerDetails key={issuer.id} issuer={issuer} active={settings.settings?.activeIssuerId === issuer.id} /></> : <p>No hay empresas emisoras registradas.</p>}
    <TaxProducts />
  </div>;
}
