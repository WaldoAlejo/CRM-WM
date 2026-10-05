import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api";
import { Field, inputClass, useAction, useSettings, type MailProfile, emailStates, date } from "./shared";

function MailForm({ profile, onDone }: { profile?: MailProfile; onDone(): void }) {
  const action = useAction();
  const [form, setForm] = useState({ name: profile?.name ?? "", host: profile?.host ?? "", port: profile?.port ?? 587, security: profile?.security ?? "STARTTLS", username: profile?.username ?? "", password: "", clearPassword: false, fromName: profile?.fromName ?? "", fromEmail: profile?.fromEmail ?? "", replyTo: profile?.replyTo ?? "", enabled: profile?.enabled ?? true });
  const [recipient, setRecipient] = useState("");
  // Resend envía por API HTTPS: no usa servidor, puerto ni usuario SMTP.
  const isResend = form.security === "RESEND";
  const textFields = ([["name", "Nombre de la cuenta"], ["fromName", "Nombre del remitente"], ["fromEmail", "Correo del remitente"], ["replyTo", "Responder a (opcional)"], ["host", "Servidor SMTP"], ["username", "Usuario SMTP"]] as const).filter(([key]) => !isResend || (key !== "host" && key !== "username"));
  const changeSecurity = (security: string) => setForm(security === "RESEND" ? { ...form, security, host: "api.resend.com", port: 443, username: "" } : { ...form, security, ...(form.security === "RESEND" ? { host: "", port: security === "TLS" ? 465 : 587 } : {}) });
  return <section className="space-y-4 rounded-md border p-5">
    <h2 className="font-semibold">{profile ? "Editar cuenta" : "Nueva cuenta de correo"}</h2>
    <form onSubmit={e => { e.preventDefault(); action.mutate({ path: `/settings/mail${profile ? `/${profile.id}` : ""}`, method: profile ? "PUT" : "POST", data: form }, { onSuccess: onDone }); }} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">{textFields.map(([key, label]) => <Field key={key} label={label}><input className={inputClass} value={form[key]} required={!['replyTo', 'username'].includes(key)} type={key.toLowerCase().includes("email") || key === "replyTo" ? "email" : "text"} onChange={e => setForm({ ...form, [key]: e.target.value })} /></Field>)}
        {!isResend && <Field label="Puerto"><input className={inputClass} type="number" min={1} max={65535} required value={form.port} onChange={e => setForm({ ...form, port: Number(e.target.value) })} /></Field>}
        <Field label="Forma de envío"><select className={inputClass} value={form.security} onChange={e => changeSecurity(e.target.value)}><option value="RESEND">Resend · API HTTPS (recomendado en Railway)</option><option value="STARTTLS">SMTP STARTTLS (habitualmente 587)</option><option value="TLS">SMTP TLS (habitualmente 465)</option></select></Field>
        <Field label={isResend ? (profile?.hasPassword ? "Nueva API key de Resend (vacío conserva la actual)" : "API key de Resend (re_…)") : profile?.hasPassword ? "Nueva contraseña (vacío conserva la actual)" : "Contraseña o contraseña de aplicación"}><input className={inputClass} type="password" autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></Field>
      </div>
      {isResend && <p className="text-sm text-muted-foreground">El correo del remitente debe ser de un dominio verificado en Resend (Domains). Las respuestas llegan al buzón de "Responder a" o al del remitente.</p>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} />Cuenta habilitada</label>
      {profile?.hasPassword && <label className="flex gap-2 text-sm"><input type="checkbox" checked={form.clearPassword} onChange={e => setForm({ ...form, clearPassword: e.target.checked })} />Eliminar la contraseña guardada (requiere dejar vacío el usuario SMTP)</label>}
      <div className="flex flex-wrap gap-2"><Button disabled={action.isPending}>Guardar cuenta</Button><Button type="button" variant="outline" onClick={onDone}>Cerrar</Button></div>
    </form>
    {profile && <div className="flex flex-wrap items-end gap-3 border-t pt-4">
      <Button variant="outline" disabled={action.isPending} onClick={() => action.mutate({ path: `/settings/mail/${profile.id}/verify` })}>Verificar conexión guardada</Button>
      <Field label="Destinatario de prueba"><input className={inputClass} type="email" value={recipient} onChange={e => setRecipient(e.target.value)} /></Field>
      <Button variant="outline" disabled={action.isPending || !recipient} onClick={() => action.mutate({ path: `/settings/mail/${profile.id}/test`, data: { recipient } })}>Enviar prueba</Button>
    </div>}
  </section>;
}
export function MailSettingsPage() {
  const query = useSettings(), action = useAction();
  const [editing, setEditing] = useState<MailProfile | "new" | null>(null);
  const deliveries = useQuery({ queryKey: ["fiscal", "mail-deliveries"], queryFn: () => apiFetch<{ id: string; recipient: string; subject: string; status: string; createdAt: string; error?: string }[]>("/settings/mail/deliveries") });
  if (query.isLoading) return <p>Cargando configuración…</p>;
  if (query.error) return <p role="alert">{query.error.message}</p>;
  return <div className="space-y-5">
    <div className="flex flex-wrap justify-between gap-4"><div><h1 className="text-2xl font-semibold">Correo</h1><p className="text-sm text-muted-foreground">Cuentas para comunicaciones con clientes y mayoristas.</p></div><Button onClick={() => setEditing("new")}>Nueva cuenta</Button></div>
    {!query.data?.encryptionReady && <p role="alert" className="rounded-md border p-3 text-sm">El servidor necesita una clave de cifrado antes de guardar credenciales.</p>}
    {editing && <MailForm key={editing === "new" ? "new" : editing.id} profile={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
    <div className="space-y-2">{query.data?.mailProfiles.map(p => <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-4"><div><p className="font-medium">{p.name} {query.data.settings?.defaultMailProfileId === p.id ? "· Predeterminada" : ""}</p><p className="text-sm text-muted-foreground">{p.fromName} &lt;{p.fromEmail}&gt; · {p.enabled ? "Habilitada" : "Desactivada"}</p></div><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setEditing(p)}>Editar y probar</Button><Button variant="outline" disabled={action.isPending || !p.enabled || query.data.settings?.defaultMailProfileId === p.id} onClick={() => action.mutate({ path: `/settings/mail/${p.id}/default` })}>Usar para comunicaciones</Button></div></div>)}</div>
    {!query.data?.mailProfiles.length && <p className="text-sm text-muted-foreground">No hay cuentas guardadas. La configuración existente del servidor seguirá funcionando hasta elegir una cuenta predeterminada.</p>}
    <section className="space-y-3"><h2 className="font-semibold">Últimos envíos</h2>{deliveries.error && <p role="alert">{deliveries.error.message}</p>}<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">Fecha</th><th>Destinatario</th><th>Asunto</th><th>Resultado</th></tr></thead><tbody>{deliveries.data?.map(d => <tr className="border-b" key={d.id}><td className="p-2">{date(d.createdAt)}</td><td>{d.recipient}</td><td>{d.subject}</td><td>{emailStates[d.status]}{d.error && <p className="text-xs">{d.error}</p>}</td></tr>)}</tbody></table></div></section>
  </div>;
}
