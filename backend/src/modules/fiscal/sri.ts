import { XMLParser } from "fast-xml-parser";
import { escapeXml } from "./xml";

const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: true });
export interface SriResult { state: "AUTHORIZED" | "REJECTED" | "RECEIVED" | "WAITING"; message: string; xml?: string; authorization?: string; authorizedAt?: Date }
function array<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
export function parseSriResponse(xml: string, action: "reception" | "authorization", expectedKey: string): SriResult {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("Respuesta XML no permitida");
  const data = parser.parse(xml)?.Envelope?.Body;
  if (!data || data.Fault) throw new Error("Respuesta SOAP inválida");
  if (action === "reception") {
    const response = data.validarComprobanteResponse?.RespuestaRecepcionComprobante;
    if (!response) throw new Error("Sin respuesta de recepción");
    const messages = array<any>(response.comprobantes?.comprobante).flatMap(c => array<any>(c.mensajes?.mensaje));
    const message = messages.map(m => `${m.identificador}: ${m.mensaje} ${m.informacionAdicional ?? ""}`).join("; ").slice(0, 4000);
    if (response.estado === "RECIBIDA") return { state: "RECEIVED", message: "Recibido por el SRI; pendiente de autorización." };
    // Already registered / processing: consult authorization, do not invent a new key.
    if (messages.some(m => ["43", "70"].includes(String(m.identificador)))) return { state: "RECEIVED", message };
    if (response.estado === "DEVUELTA") return { state: "REJECTED", message: message || "Comprobante devuelto por el SRI" };
    throw new Error("Estado de recepción desconocido");
  }
  const response = data.autorizacionComprobanteResponse?.RespuestaAutorizacionComprobante;
  if (!response || String(response.claveAccesoConsultada ?? "").trim() !== expectedKey) throw new Error("Respuesta no corresponde a la clave consultada");
  const authorizations = array<any>(response.autorizaciones?.autorizacion);
  const authorized = authorizations.find(a => String(a.estado).trim() === "AUTORIZADO");
  if (authorized) {
    if (String(authorized.numeroAutorizacion ?? "").trim() !== expectedKey || !authorized.comprobante || !authorized.fechaAutorizacion) throw new Error("Autorización incompleta");
    const payload = parser.parse(authorized.comprobante);
    const root = payload.factura ?? payload.notaCredito ?? payload.guiaRemision;
    if (String(root?.infoTributaria?.claveAcceso ?? "").trim() !== expectedKey) throw new Error("El XML autorizado no corresponde a la clave");
    const authorizedAt = new Date(authorized.fechaAutorizacion);
    if (!Number.isFinite(authorizedAt.getTime())) throw new Error("Fecha inválida");
    const wrapper = `<?xml version="1.0" encoding="UTF-8"?><autorizacion><estado>AUTORIZADO</estado><numeroAutorizacion>${expectedKey}</numeroAutorizacion><fechaAutorizacion>${escapeXml(authorized.fechaAutorizacion)}</fechaAutorizacion><ambiente>${escapeXml(authorized.ambiente)}</ambiente><comprobante><![CDATA[${String(authorized.comprobante).replace(/]]>/g, "]]]]><![CDATA[>")}]]></comprobante><mensajes/></autorizacion>`;
    return { state: "AUTHORIZED", message: "Autorizado por el SRI", xml: wrapper, authorization: expectedKey, authorizedAt };
  }
  // The ficha técnica documents RECHAZADO; the service also answers NO AUTORIZADO.
  const rejected = authorizations.find(a => ["NO AUTORIZADO", "RECHAZADO"].includes(String(a.estado).trim()));
  if (rejected) return { state: "REJECTED", message: array<any>(rejected.mensajes?.mensaje).map(m => `${m.identificador}: ${m.mensaje} ${m.informacionAdicional ?? ""}`).join("; ").slice(0, 4000) || "No autorizado" };
  return { state: "WAITING", message: "El SRI todavía no devuelve autorización." };
}
export async function callSri(environment: string, action: "reception" | "authorization", accessKey: string, signedXml?: string): Promise<SriResult> {
  if (environment !== "1" && environment !== "2") throw new Error("Ambiente inválido");
  const host = environment === "1" ? "celcer.sri.gob.ec" : "cel.sri.gob.ec";
  const reception = action === "reception";
  const endpoint = `https://${host}/comprobantes-electronicos-ws/${reception ? "Recepcion" : "Autorizacion"}ComprobantesOffline`;
  const operation = reception ? `<ns:validarComprobante><xml>${Buffer.from(signedXml!, "utf8").toString("base64")}</xml></ns:validarComprobante>` : `<ns:autorizacionComprobante><claveAccesoComprobante>${accessKey}</claveAccesoComprobante></ns:autorizacionComprobante>`;
  const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "" },
    body: `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns="http://ec.gob.sri.ws.${reception ? "recepcion" : "autorizacion"}"><soap:Body>${operation}</soap:Body></soap:Envelope>` });
  if (!response.ok) throw new Error("Servicio SRI no disponible");
  const body = await response.text();
  if (body.length > 5_000_000) throw new Error("Respuesta demasiado grande");
  return parseSriResponse(body, action, accessKey);
}
