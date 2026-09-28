import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Field, inputClass, useAction } from "./shared";

export function DispatchFiscalSection({ orderId, pending, fiscalIssuerId }: { orderId: string; pending: boolean; fiscalIssuerId?: string | null }) {
  const action = useAction(), navigate = useNavigate(); const [open, setOpen] = useState(false);
  const [transport, setTransport] = useState({ startDate: "", endDate: "", origin: "", destination: "", carrierName: "", carrierId: "", carrierIdType: "04", plate: "", reason: "Traslado de mercadería" });
  return <section className="space-y-3 rounded-md border p-4"><h2 className="font-semibold">Comprobantes electrónicos</h2>
    <div className="flex flex-wrap gap-2"><Button variant="outline" asChild><Link to={`/billing?orderId=${orderId}`}>Ver comprobantes</Link></Button>{fiscalIssuerId && !pending && <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate({ path: `/fiscal-documents/orders/${orderId}/invoice` }, { onSuccess: doc => navigate(`/billing/${doc.id}`) })}>Revisar factura</Button>}{fiscalIssuerId && pending && <Button variant="outline" onClick={() => setOpen(!open)}>Preparar guía de remisión</Button>}</div>
    {!fiscalIssuerId && <p className="text-sm text-muted-foreground">Este despacho no tiene emisor fiscal asignado. La configuración se aplica a nuevas órdenes.</p>}
    {open && <form className="space-y-3" onSubmit={e => { e.preventDefault(); action.mutate({ path: `/fiscal-documents/orders/${orderId}/guide`, data: transport }, { onSuccess: doc => navigate(`/billing/${doc.id}`) }); }}><div className="grid gap-3 md:grid-cols-2">{([["startDate", "Inicio del traslado"], ["endDate", "Fin del traslado"], ["origin", "Dirección de partida"], ["destination", "Dirección de destino"], ["carrierName", "Nombre / razón social del transportista"], ["carrierId", "Identificación del transportista"], ["plate", "Placa"], ["reason", "Motivo del traslado"]] as const).map(([key, label]) => <Field key={key} label={label}><input required className={inputClass} type={key.endsWith("Date") ? "date" : "text"} value={transport[key]} onChange={e => setTransport({ ...transport, [key]: e.target.value })} /></Field>)}<Field label="Tipo de identificación del transportista"><select className={inputClass} value={transport.carrierIdType} onChange={e => setTransport({ ...transport, carrierIdType: e.target.value })}><option value="04">RUC</option><option value="05">Cédula</option></select></Field></div><Button disabled={action.isPending}>Guardar borrador de guía</Button></form>}
  </section>;
}
