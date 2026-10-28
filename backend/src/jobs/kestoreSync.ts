import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { kestoreSecret, kestoreWebhookUrl, signKestorePayload } from "../modules/kestore/kestore.config";
import { findKestoreVariants, kestoreState } from "../modules/kestore/kestore.catalog";

const INTERVAL_MS = 10_000;
const MAX_ITEMS = 500;
const REQUEST_TIMEOUT_MS = 15_000;

interface StockItem { codigo: string; stock: number; precio: number; precioSinIva: number; activo: boolean }
interface PendingState { variantId: string; code: string; stock: number; price: Prisma.Decimal; active: boolean }

// Compara el estado actual de cada variante con el último que Kestore aceptó y
// arma solo los cambios. Si cambió el código de Kestore, el código viejo se
// envía inactivo para que no quede publicado con un stock que ya no se mueve.
export async function pendingKestoreChanges() {
  const items: StockItem[] = [];
  const states: PendingState[] = [];
  for (const variant of await findKestoreVariants()) {
    const state = kestoreState(variant);
    const previous = variant.kestoreSyncState;
    const code = variant.kestoreCode ?? previous!.code;
    if (previous && previous.code !== code && previous.active) {
      items.push({ codigo: previous.code, stock: 0, precio: previous.price.toNumber(), precioSinIva: 0, activo: false });
    }
    const unchanged = previous && previous.code === code && previous.stock === state.stock
      && previous.price.equals(state.price) && previous.active === state.active;
    // Una variante que nunca se publicó y sigue sin publicarse no se le envía.
    if (unchanged || (!previous && !state.active)) continue;
    items.push({ codigo: code, stock: state.stock, precio: state.price.toNumber(), precioSinIva: state.priceWithoutIva.toNumber(), activo: state.active });
    states.push({ variantId: variant.id, code, stock: state.stock, price: state.price, active: state.active });
  }
  return { items, states };
}

export async function sendKestoreStock(url: string, secret: string, items: StockItem[], fetchImpl: typeof fetch = fetch) {
  const body = JSON.stringify({ evento: "stock", enviadoEn: new Date().toISOString(), items });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Crm-Timestamp": timestamp, "X-Crm-Signature": signKestorePayload(secret, timestamp, body) },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Kestore respondió ${response.status}: ${(await response.text()).slice(0, 200)}`);
}

let running = false;
let failures = 0;
let nextAttemptAt = 0;

export async function runKestoreSync(fetchImpl: typeof fetch = fetch) {
  const url = kestoreWebhookUrl();
  const secret = kestoreSecret();
  if (!url || !secret || running || Date.now() < nextAttemptAt) return;
  running = true;
  try {
    const { items, states } = await pendingKestoreChanges();
    for (let start = 0; start < items.length; start += MAX_ITEMS) {
      await sendKestoreStock(url, secret, items.slice(start, start + MAX_ITEMS), fetchImpl);
    }
    // Solo después de que Kestore aceptó todo: si falla, el próximo ciclo
    // vuelve a calcular y reenvía (Kestore aplica el último valor recibido).
    const sentAt = new Date();
    for (const { variantId, ...data } of states) {
      await prisma.kestoreSyncState.upsert({ where: { variantId }, create: { variantId, ...data, sentAt }, update: { ...data, sentAt } });
    }
    if (items.length) console.log(`[kestore] ${items.length} producto(s) enviados.`);
    failures = 0;
  } catch (error) {
    failures++;
    // Espera creciente hasta 5 minutos para no insistir contra un Kestore caído.
    nextAttemptAt = Date.now() + Math.min(300_000, INTERVAL_MS * 2 ** failures);
    console.error(`[kestore] No se pudo enviar el stock (intento ${failures}): ${error instanceof Error ? error.message : error}`);
  } finally {
    running = false;
  }
}

export function resetKestoreSyncBackoff() {
  failures = 0;
  nextAttemptAt = 0;
}

export function startKestoreSync() {
  if (process.env.KESTORE_SYNC_ENABLED === "false" || !kestoreWebhookUrl() || !kestoreSecret()) return () => {};
  const run = () => void runKestoreSync();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  run();
  return () => clearInterval(timer);
}
