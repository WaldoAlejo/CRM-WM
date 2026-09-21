// E2E contra el backend real: Consignación (ADMIN/CEO) y Cuarentena (OPERATOR+).
// Flujo completo: crear lote → reportar liquidación (vendido + devuelto) →
// checklist que PASA (reingresa stock a la ubicación original) → checklist que
// NO PASA (genera el cargo a crédito) → verificar el cargo y el stock.
//
// dueDate/nextReviewDate no se pueden mover por API (a propósito: una revisión
// vencida solo ocurre con el tiempo), así que el caso "revisión vencida" del
// Dashboard se prepara con Prisma directo, igual que accountsReceivable.e2e.
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { beforeAll, describe, expect, it } from "vitest";
import { RequireRole } from "@/components/auth/RequireRole";
import { Sidebar } from "@/components/layout/Sidebar";
import { AuthProvider } from "@/context/AuthContext";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { QuarantinePage } from "@/features/quarantine/QuarantinePage";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { ConsignmentDetailPage } from "./ConsignmentDetailPage";
import { ConsignmentPage } from "./ConsignmentPage";
import type { ConsignmentLotDetail } from "./consignment.types";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const CREDENTIALS = {
  admin: { email: "admin@kestore.com.ec", password: "Admin123!" },
  operator: { email: "operador@kestore.com.ec", password: "Operador123!" },
} as const;
type RoleKey = keyof typeof CREDENTIALS;
const USER_STORAGE_KEY = "wm_kestore_user";

const STAMP = Date.now();
const PRICE = 20;
const BACKEND_DIR = path.resolve(process.cwd(), "../backend");

function loginAs(role: RoleKey) {
  return fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CREDENTIALS[role]),
  }).then((res) => res.json() as Promise<{ token: string; user: AuthUser }>);
}

async function signInAs(role: RoleKey) {
  const session = await loginAs(role);
  setToken(session.token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
}

function backdateNextReview(lotId: string, daysAgo: number) {
  const scriptPath = path.join(BACKEND_DIR, `.e2e-backdate-lot-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
  writeFileSync(
    scriptPath,
    `
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.consignmentLot.update({
  where: { id: ${JSON.stringify(lotId)} },
  data: { nextReviewDate: new Date(Date.now() - ${daysAgo} * 24 * 60 * 60 * 1000) },
}).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
`
  );
  try {
    execFileSync("node", [scriptPath], { cwd: BACKEND_DIR });
  } finally {
    unlinkSync(scriptPath);
  }
}

function renderApp(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route element={<RequireRole roles={["ADMIN"]} />}>
              <Route path="/consignment" element={<ConsignmentPage />} />
              <Route path="/consignment/:id" element={<ConsignmentDetailPage />} />
            </Route>
            <Route element={<RequireRole roles={["OPERATOR"]} />}>
              <Route path="/quarantine" element={<QuarantinePage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function renderSidebar() {
  return render(
    <AuthProvider>
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    </AuthProvider>
  );
}

// La cola de Cuarentena se acumula en la base compartida y pagina de a 20:
// se recorre como lo haría un usuario en vez de asumir que la fila propia cae
// en la primera página.
async function findQueueRow(sku: string): Promise<HTMLElement> {
  await screen.findByRole("heading", { name: /cuarentena/i }, { timeout: 8000 });
  for (let attempt = 0; attempt < 30; attempt++) {
    await waitFor(
      () => {
        if (screen.queryByText(new RegExp(sku))) return;
        if (screen.queryByRole("button", { name: /siguiente/i })) return;
        // sin fila y sin paginación: todavía cargando
        if (!screen.queryByText(/no hay unidades pendientes/i) && !screen.queryByRole("table")) throw new Error("cargando");
      },
      { timeout: 8000 }
    );
    const found = screen.queryByText(new RegExp(sku));
    if (found) return found;
    const next = screen.queryByRole("button", { name: /siguiente/i }) as HTMLButtonElement | null;
    if (!next || next.disabled) break;
    fireEvent.click(next);
    await new Promise((r) => setTimeout(r, 400));
  }
  return screen.findByText(new RegExp(sku), {}, { timeout: 3000 });
}

async function answerAllYes(dialog: HTMLElement) {
  for (const name of ["Caja en buen estado", "Producto sin daños visibles", "Piezas completas"]) {
    fireEvent.click(within(within(dialog).getByRole("group", { name })).getByRole("button", { name: "Sí" }));
  }
}

describe("Consignación y Cuarentena — de punta a punta contra el backend real", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let variantSku: string;
  let warehouseId: string;
  let locationId: string;
  let wholesalerId: string;
  let lot: ConsignmentLotDetail;

  async function netStockAtLocation(): Promise<number> {
    const res = await apiFetch<{ data: { netStock: number }[] }>(
      `/inventory/stock-by-location?locationId=${locationId}&variantId=${variantId}`
    );
    return res.data[0]?.netStock ?? 0;
  }

  async function variantStock(): Promise<number> {
    const detail = await apiFetch<{ variants: { id: string; stock: number }[] }>(`/products/${productId}`);
    return detail.variants.find((v) => v.id === variantId)!.stock;
  }

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    await signInAs("admin");

    categoryId = (
      await apiFetch<{ id: string }>("/categories", { method: "POST", body: JSON.stringify({ name: `E2E Consig Cat ${STAMP}` }) })
    ).id;
    productId = (
      await apiFetch<{ id: string }>("/products", {
        method: "POST",
        body: JSON.stringify({ sku: `E2E-CONS-${STAMP}`, name: "Producto Consignación", categoryId }),
      })
    ).id;
    variantSku = `E2E-CONS-VAR-${STAMP}`;
    variantId = (
      await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
        method: "POST",
        body: JSON.stringify({ attributes: { color: "Azul" }, sku: variantSku }),
      })
    ).id;

    // Bodega nueva: nace con su Cuarentena (no se crea a mano) — la ubicación
    // normal sí.
    warehouseId = (
      await apiFetch<{ id: string }>("/warehouses", { method: "POST", body: JSON.stringify({ name: `E2E Consig Bodega ${STAMP}` }) })
    ).id;
    locationId = (
      await apiFetch<{ id: string }>(`/warehouses/${warehouseId}/locations`, {
        method: "POST",
        body: JSON.stringify({ code: `C-${STAMP}` }),
      })
    ).id;

    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId, quantity: 50, reason: "Stock inicial para test E2E de consignación", locationId }),
    });

    wholesalerId = (
      await apiFetch<{ id: string }>("/wholesalers", {
        method: "POST",
        body: JSON.stringify({ businessName: `E2E Mayorista Consig ${STAMP}`, ruc: String(STAMP), defaultCreditDays: 30 }),
      })
    ).id;

    lot = await apiFetch<ConsignmentLotDetail>("/consignment/lots", {
      method: "POST",
      body: JSON.stringify({
        wholesalerId,
        shippingProvince: "Guayas",
        shippingCity: "Guayaquil",
        lines: [{ variantId, quantity: 10, unitPrice: PRICE, locationId }],
      }),
    });
  }, 60000);

  it("crear lote: sale de bodega SIN cargo ni cuenta por cobrar, en consignación y con revisión a 20 días", async () => {
    expect(lot.status).toBe("EN_CONSIGNACION");
    expect(lot.lines[0]).toMatchObject({ quantityDelivered: 10, pending: 10 });
    expect(await variantStock()).toBe(40); // 50 − 10
    expect(await netStockAtLocation()).toBe(40);
    expect(lot.reviews).toHaveLength(0); // ningún cargo asociado todavía

    // Y el listado (ADMIN) lo muestra con su estado y próxima revisión.
    await signInAs("admin");
    renderApp("/consignment");
    await screen.findByRole("heading", { name: /consignación/i });
    expect(await screen.findByText(lot.code, {}, { timeout: 8000 })).toBeInTheDocument();
  }, 30000);

  it("liquidación (UI): vendió 4 y devuelve 6 → se cobra lo vendido, lo devuelto queda en Cuarentena y el lote se cierra", async () => {
    await signInAs("admin");
    renderApp(`/consignment/${lot.id}`);

    await screen.findByRole("heading", { name: lot.code }, { timeout: 8000 });
    fireEvent.click(await screen.findByRole("button", { name: /registrar revisión/i }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(`Vendidas ${variantSku}`), { target: { value: "4" } });
    fireEvent.change(within(dialog).getByLabelText(`Devueltas ${variantSku}`), { target: { value: "6" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /registrar liquidación/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 10000 });

    const updated = await apiFetch<ConsignmentLotDetail>(`/consignment/lots/${lot.id}`);
    expect(updated.status).toBe("CERRADO");
    expect(updated.lines[0]).toMatchObject({ sold: 4, returned: 6, pending: 0 });

    // Cargo por lo vendido: una orden a crédito real (30 días), 4 × $20.
    const charge = updated.reviews[0].chargeOrder!;
    const order = await apiFetch<{
      origin: string;
      paymentMethod: string;
      creditDays: number;
      items: { quantity: number; unitPrice: string }[];
    }>(`/dispatch-orders/${charge.id}`);
    expect(order).toMatchObject({ origin: "CONSIGNACION_LIQUIDACION", paymentMethod: "CREDITO", creditDays: 30 });
    expect(order.items).toHaveLength(1);
    expect(order.items[0].quantity).toBe(4);
    expect(Number(order.items[0].unitPrice)).toBe(PRICE);

    // Lo devuelto NO vuelve a stock todavía: espera checklist.
    expect(await variantStock()).toBe(40);
    expect(updated.reviews[0].returnBatch?.completedAt).toBeNull();
    lot = updated;
  }, 60000);

  it("Cuarentena (OPERATOR): el checklist que PASA reingresa 5 unidades a la MISMA ubicación de origen", async () => {
    await signInAs("operator");
    renderApp("/quarantine");

    const cell = await findQueueRow(variantSku);
    const row = cell.closest("tr")!;
    expect(row.textContent).toMatch(/6\s*de 6/); // 6 pendientes de 6
    // La cola nunca muestra precios ni costos.
    expect(row.textContent ?? "").not.toMatch(/\$|precio|costo/i);
    fireEvent.click(within(row).getByRole("button", { name: /revisar/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/unidades que estás revisando/i), { target: { value: "5" } });
    // Sin responder no se puede registrar: nada queda aprobado por defecto.
    expect(within(dialog).getByRole("button", { name: /registrar resultado/i })).toBeDisabled();
    await answerAllYes(dialog);
    expect(await within(dialog).findByText(/resultado: pasa/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /registrar resultado/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 10000 });

    // 40 + 5 reingresados, y en la ubicación original (no como ingreso nuevo).
    expect(await variantStock()).toBe(45);
    expect(await netStockAtLocation()).toBe(45);
    const movements = await apiFetch<{ data: { type: string; quantity: number; toLocationId: string | null }[] }>(
      `/inventory/movements?variantId=${variantId}&pageSize=100`
    );
    const back = movements.data.find((m) => m.type === "DEVOLUCION");
    expect(back).toMatchObject({ quantity: 5, toLocationId: locationId });
    expect(movements.data.filter((m) => m.type === "INGRESO")).toHaveLength(0);
  }, 60000);

  it("Cuarentena (OPERATOR): el checklist que NO PASA de la última unidad no reingresa stock y genera el cargo a crédito al mayorista", async () => {
    await signInAs("operator");
    renderApp("/quarantine");

    const row = (await findQueueRow(variantSku)).closest("tr")!;
    expect(row.textContent).toMatch(/1\s*de 6/);
    fireEvent.click(within(row).getByRole("button", { name: /revisar/i }));

    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(within(dialog).getByRole("group", { name: "Caja en buen estado" })).getByRole("button", { name: "No" }));
    for (const name of ["Producto sin daños visibles", "Piezas completas"]) {
      fireEvent.click(within(within(dialog).getByRole("group", { name })).getByRole("button", { name: "Sí" }));
    }
    fireEvent.change(within(dialog).getByLabelText(/otro \/ observación/i), { target: { value: "Caja aplastada" } });
    const hint = await within(dialog).findByText(/resultado: no pasa/i);
    // OPERATOR ve que habrá cargo, pero ningún monto.
    expect(hint.textContent ?? "").not.toMatch(/\$/);
    fireEvent.click(within(dialog).getByRole("button", { name: /registrar resultado/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 10000 });

    // Stock intacto: la unidad que no pasó no reingresa.
    expect(await variantStock()).toBe(45);
    expect(await netStockAtLocation()).toBe(45);

    // El cargo por no conformes existe como cuenta por cobrar normal.
    await signInAs("admin");
    const updated = await apiFetch<ConsignmentLotDetail>(`/consignment/lots/${lot.id}`);
    const batch = updated.reviews[0].returnBatch!;
    expect(batch.completedAt).not.toBeNull();
    const chargeId = batch.chargeOrder!.id;
    const charge = await apiFetch<{
      origin: string;
      paymentMethod: string;
      status: string;
      creditDays: number;
      dueDate: string;
      items: { quantity: number; unitPrice: string }[];
    }>(`/dispatch-orders/${chargeId}`);
    expect(charge).toMatchObject({ origin: "CONSIGNACION_DEVOLUCION_NO_CONFORME", paymentMethod: "CREDITO", status: "DESPACHADO", creditDays: 30 });
    expect(charge.items).toHaveLength(1);
    expect(charge.items[0].quantity).toBe(1);
    expect(Number(charge.items[0].unitPrice)).toBe(PRICE); // mismo precio que una unidad vendida
    const days = (new Date(charge.dueDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(Math.round(days)).toBe(30); // desde la fecha de inspección

    // Y como es una orden más, entra al ledger de Cobros como cualquier otra.
    await apiFetch(`/dispatch-orders/${chargeId}/payments`, {
      method: "POST",
      body: JSON.stringify({ amount: PRICE, method: "transferencia" }),
    });
    const settled = await apiFetch<{ paymentStatus: string }>(`/dispatch-orders/${chargeId}`);
    expect(settled.paymentStatus).toBe("PAGADO");
  }, 60000);

  it("Dashboard: un lote con la revisión vencida aparece como alerta para ADMIN (y no para OPERATOR)", async () => {
    await signInAs("admin");
    const overdue = await apiFetch<ConsignmentLotDetail>("/consignment/lots", {
      method: "POST",
      body: JSON.stringify({
        wholesalerId,
        shippingProvince: "Guayas",
        shippingCity: "Guayaquil",
        lines: [{ variantId, quantity: 1, unitPrice: PRICE, locationId }],
      }),
    });
    backdateNextReview(overdue.id, 3);

    const alerts = await apiFetch<{ count: number; data: { id: string; displayStatus: string }[] }>(
      "/consignment/alerts/overdue-reviews"
    );
    expect(alerts.data.find((l) => l.id === overdue.id)?.displayStatus).toBe("REVISION_VENCIDA");

    const view = renderApp("/");
    expect(await screen.findByText("Consignación: revisión vencida", {}, { timeout: 8000 })).toBeInTheDocument();
    view.unmount();

    // El lote vencido se ve como tal en el listado filtrado, con su próxima revisión en rojo.
    renderApp("/consignment?overdue=true");
    expect(await screen.findByText(overdue.code, {}, { timeout: 8000 })).toBeInTheDocument();
    expect(screen.getAllByText("Revisión vencida").length).toBeGreaterThan(0);

    // Limpieza: el lote vencido ocupa 1 unidad; se cierra devolviéndola y validándola.
    const fresh = await apiFetch<ConsignmentLotDetail>(`/consignment/lots/${overdue.id}`);
    await apiFetch(`/consignment/lots/${overdue.id}/reviews`, {
      method: "POST",
      body: JSON.stringify({ action: "LIQUIDAR", lines: [{ lineId: fresh.lines[0].id, quantitySold: 0, quantityReturned: 1 }] }),
    });
    const queue = await apiFetch<{ data: { id: string; variant: { sku: string } }[] }>("/quarantine/queue?pageSize=100");
    for (const l of queue.data.filter((q) => q.variant.sku === variantSku)) {
      await apiFetch(`/quarantine/lines/${l.id}/inspections`, {
        method: "POST",
        body: JSON.stringify({ quantity: 1, boxOk: true, noVisibleDamage: true, piecesComplete: true }),
      });
    }
  }, 60000);

  it("permisos: OPERATOR ve Cuarentena pero NO Consignación en el menú, y por URL directa es redirigido; ADMIN ve ambas", async () => {
    await signInAs("operator");
    const operatorMenu = renderSidebar();
    expect(await screen.findByText("Cuarentena")).toBeInTheDocument();
    expect(screen.queryByText("Consignación")).not.toBeInTheDocument();
    operatorMenu.unmount();

    for (const path of ["/consignment", `/consignment/${lot.id}`]) {
      const view = renderApp(path);
      // Redirigido al inicio (Dashboard): nunca ve la página ni los precios del lote.
      await screen.findByRole("heading", { name: /^dashboard$/i }, { timeout: 8000 });
      expect(screen.queryByText(lot.code), path).not.toBeInTheDocument();
      view.unmount();
    }

    // El backend también lo rechaza: no depende solo del ocultamiento del front.
    await expect(apiFetch("/consignment/lots")).rejects.toMatchObject({ status: 403 });

    await signInAs("admin");
    renderSidebar();
    expect(await screen.findByText("Consignación")).toBeInTheDocument();
    expect(screen.getByText("Cuarentena")).toBeInTheDocument();
  }, 60000);
});
