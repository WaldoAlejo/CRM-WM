import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { toast } from "sonner";
import { apiFetch, apiFetchBlob } from "@/lib/api";

export interface MailProfile { id: string; name: string; host: string; port: number; security: string; username: string; fromName: string; fromEmail: string; replyTo?: string; enabled: boolean; hasPassword: boolean }
export interface Certificate { id: string; subject: string; issuedBy: string; serialNumber: string; validFrom: string; validTo: string; retiredAt: string | null }
export interface Series { id: string; environment: string; documentType: string; establishment: string; emissionPoint: string; address: string; lastNumber: number }
export interface Issuer { id: string; ruc: string; legalName: string; tradeName?: string; address: string; accountingRequired: boolean; specialTaxpayer?: string; withholdingAgent?: string; regime: string; environment: string; mailProfileId: string | null; enabledForEmission: boolean; certificates: Certificate[]; series: Series[] }
export interface Settings { settings: { activeIssuerId: string | null; defaultMailProfileId: string | null } | null; mailProfiles: MailProfile[]; issuers: Issuer[]; encryptionReady: boolean; productionEnabled: boolean }
export const types: Record<string, string> = { "01": "Factura", "04": "Nota de crédito", "06": "Guía de remisión" };
export const states: Record<string, string> = { DRAFT: "Borrador por revisar", QUEUED: "Firmado · pendiente de envío", RECEIVED: "Recibido por SRI", WAITING: "Esperando respuesta SRI", AUTHORIZED: "Autorizado", REJECTED: "Devuelto / no autorizado", VOID: "Borrador descartado", CANCELLED: "Anulado" };
export const cancellations: Record<string, string> = { NONE: "Sin trámite", REQUESTED: "Solicitud registrada", CONFIRMED: "Anulación confirmada en portal", REJECTED: "Anulación rechazada" };
export const emailStates: Record<string, string> = { PENDING: "Pendiente", SENT: "Enviado al servidor", FAILED: "Fallido" };
export function useSettings() { return useQuery({ queryKey: ["fiscal-settings"], queryFn: () => apiFetch<Settings>("/settings") }); }
export function useAction() {
  const client = useQueryClient();
  return useMutation({ mutationFn: ({ path, data, method = "POST" }: { path: string; data?: unknown; method?: string }) => apiFetch<any>(path, { method, body: data instanceof FormData ? data : data === undefined ? undefined : JSON.stringify(data) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["fiscal-settings"] }); await client.invalidateQueries({ queryKey: ["fiscal"] }); toast.success("Operación completada"); }, onError: error => toast.error(error.message) });
}
export function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="flex flex-col gap-1 text-sm"><span>{label}</span>{children}</label>; }
export const inputClass = "h-9 w-full rounded-md border bg-background px-3 text-sm disabled:opacity-50";
export const money = (value: string | number) => Number(value).toLocaleString("es-EC", { style: "currency", currency: "USD" });
export const date = (value: string) => new Date(value).toLocaleDateString("es-EC", { timeZone: "America/Guayaquil" });
export async function downloadFiscal(id: string, extension: string, name: string) {
  try {
    const blob = await apiFetchBlob(`/fiscal-documents/${id}/${extension}`);
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `${name}.${extension}`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { toast.error(e instanceof Error ? e.message : "No se pudo descargar"); }
}
