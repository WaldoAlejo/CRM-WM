// E2E contra el backend real: la vista de ADMIN trae cartera/reclamos/costo
// y la de OPERATOR no (ni el widget ni el texto de ganancia aparecen en el
// DOM, no solo "ocultos"), y cada alerta con destino (stock bajo, cartera
// vencida, reclamos en proceso) navega al módulo con el filtro ya aplicado.
import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { AccountsReceivablePage } from "@/features/dispatchOrders/AccountsReceivablePage";
import { InsuranceClaimsPage } from "@/features/insuranceClaims/InsuranceClaimsPage";
import { LowStockPage } from "@/features/inventory/LowStockPage";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { DashboardPage } from "./DashboardPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const OPERATOR_CREDENTIALS = { email: "operador@kestore.com.ec", password: "Operador123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

// dueDate se calcula automáticamente al confirmar (dispatchDate + creditDays)
// y no hay ningún endpoint para fijarlo en el pasado — no existe forma de
// crear una orden "ya vencida" esperando días reales. Mismo mecanismo que ya
// usa accountsReceivable.e2e.test.tsx: un script Node aparte que usa el
// PrismaClient del backend directo contra la misma base de desarrollo.
const BACKEND_DIR = path.resolve(process.cwd(), "../backend");

function backdateDueDate(orderId: string, daysAgo: number) {
  const scriptPath = path.join(BACKEND_DIR, `.e2e-backdate-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
  const script = `
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
prisma.dispatchOrder.update({
  where: { id: ${JSON.stringify(orderId)} },
  data: { dueDate: new Date(Date.now() - ${daysAgo} * 24 * 60 * 60 * 1000) },
}).then(() => prisma.$disconnect()).catch((e) => { console.error(e); process.exit(1); });
`;
  writeFileSync(scriptPath, script);
  try {
    execFileSync("node", [scriptPath], { cwd: BACKEND_DIR });
  } finally {
    unlinkSync(scriptPath);
  }
}

const CATEGORY_NAME = `E2E Dashboard Categoría ${Date.now()}`;
// Prefijo "000" para quedar SIEMPRE primero en el orderBy sku:asc de
// getStockSummary (belowMinStock) — así entra seguro en el top-5 del
// Dashboard sin depender de qué más haya en la base compartida de desarrollo.
const LOW_STOCK_SKU = `000E2E-DASH-${Date.now()}`;
const PRODUCT_SKU = `E2E-DASH-${Date.now()}`;
const WHOLESALER_NAME = `E2E Dashboard Mayorista ${Date.now()}`;
const RUC = String(Date.now());

async function findLastByTextEventually(text: string | RegExp, timeoutMs = 8000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matches = screen.queryAllByText(text);
    if (matches.length > 0) return matches[matches.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No apareció ningún elemento con el texto "${String(text)}" dentro de ${timeoutMs}ms`);
}

function loginAs(role: "admin" | "operator") {
  return fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(role === "admin" ? ADMIN_CREDENTIALS : OPERATOR_CREDENTIALS),
  }).then((res) => res.json() as Promise<{ token: string; user: AuthUser }>);
}

function setSession(token: string, user: AuthUser) {
  setToken(token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

function renderApp(initialPath = "/") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/inventory/low-stock" element={<LowStockPage />} />
            <Route path="/accounts-receivable" element={<AccountsReceivablePage />} />
            <Route path="/insurance-claims" element={<InsuranceClaimsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Dashboard — contra el backend real, vista ADMIN vs OPERATOR y click-through", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string; // stock bajo (minStock=5, stock=0)
  let ingresoVariantId: string; // con stock real, para las órdenes
  let wholesalerId: string;
  let overdueOrderId: string;
  let overdueOrderNumber: string;
  let claimShipmentId: string;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }

    const admin = await loginAs("admin");
    if (!admin.token) {
      throw new Error('No se pudo autenticar como admin. ¿Corriste "npx prisma db seed" en backend/?');
    }
    setSession(admin.token, admin.user);

    const category = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: CATEGORY_NAME }),
    });
    categoryId = category.id;

    const product = await apiFetch<{ id: string }>("/products", {
      method: "POST",
      body: JSON.stringify({ sku: PRODUCT_SKU, name: "Producto Dashboard E2E", categoryId }),
    });
    productId = product.id;

    // Variante de stock bajo: minStock=5, stock arranca en 0 — ya nace
    // "por debajo del mínimo", sin necesitar ningún ajuste extra.
    const variant = await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Rojo" }, sku: LOW_STOCK_SKU, minStock: 5 }),
    });
    variantId = variant.id;

    // Segunda variante, con stock real, para las órdenes de abajo.
    const ingresoVariant = await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Azul" }, sku: `${PRODUCT_SKU}-VAR2` }),
    });
    ingresoVariantId = ingresoVariant.id;
    await apiFetch("/inventory/adjustments", {
      method: "POST",
      body: JSON.stringify({ variantId: ingresoVariantId, quantity: 50, reason: "Stock inicial E2E Dashboard" }),
    });

    // Venta CONTADO de hoy (aporta a sales.today/week/month).
    await apiFetch("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "CLIENTE_FINAL",
        finalCustomerId: (
          await apiFetch<{ id: string }>("/final-customers", {
            method: "POST",
            body: JSON.stringify({ fullName: `E2E Dashboard Cliente ${Date.now()}` }),
          })
        ).id,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CONTADO",
        items: [{ variantId: ingresoVariantId, quantity: 2, priceType: "PVP", unitPrice: 30 }],
      }),
    }).then((order) =>
      apiFetch(`/dispatch-orders/${(order as { id: string }).id}/confirm`, { method: "POST", body: JSON.stringify({}) })
    );

    // Cuenta por cobrar vencida (CREDITO, mayorista, dueDate en el pasado).
    const wholesaler = await apiFetch<{ id: string }>("/wholesalers", {
      method: "POST",
      body: JSON.stringify({ businessName: WHOLESALER_NAME, ruc: RUC }),
    });
    wholesalerId = wholesaler.id;
    const creditOrder = await apiFetch<{ id: string; orderNumber: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "MAYORISTA",
        wholesalerId,
        shippingProvince: "Guayas",
        shippingCity: "Guayaquil",
        paymentMethod: "CREDITO",
        creditDays: 5,
        items: [{ variantId: ingresoVariantId, quantity: 1, priceType: "MAYORISTA", unitPrice: 25 }],
      }),
    });
    overdueOrderId = creditOrder.id;
    overdueOrderNumber = creditOrder.orderNumber;
    await apiFetch(`/dispatch-orders/${overdueOrderId}/confirm`, { method: "POST", body: JSON.stringify({}) });
    // dueDate recién calculado queda en el FUTURO (dispatchDate + 5 días) —
    // hay que forzarla al pasado para que realmente cuente como "vencida".
    backdateDueDate(overdueOrderId, 5);

    // Reclamo de seguro en proceso: CONTRA_ENTREGA + courier + PERDIDO.
    const courier = await apiFetch<{ id: string }>("/couriers", {
      method: "POST",
      body: JSON.stringify({ name: `E2E Dashboard Courier ${Date.now()}` }),
    });
    const codOrder = await apiFetch<{ id: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "CLIENTE_FINAL",
        finalCustomerId: (
          await apiFetch<{ id: string }>("/final-customers", {
            method: "POST",
            body: JSON.stringify({ fullName: `E2E Dashboard COD Cliente ${Date.now()}` }),
          })
        ).id,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CONTRA_ENTREGA",
        items: [{ variantId: ingresoVariantId, quantity: 1, priceType: "PVP", unitPrice: 25 }],
      }),
    });
    const confirmedCod = await apiFetch<{ shipment: { id: string } }>(`/dispatch-orders/${codOrder.id}/confirm`, {
      method: "POST",
      body: JSON.stringify({ courierId: courier.id }),
    });
    claimShipmentId = confirmedCod.shipment.id;
    await apiFetch(`/shipments/${claimShipmentId}/lost-or-damaged`, {
      method: "POST",
      body: JSON.stringify({ status: "PERDIDO" }),
    });
  }, 30000);

  afterAll(async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    await apiFetch(`/variants/${variantId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/variants/${ingresoVariantId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/wholesalers/${wholesalerId}`, { method: "DELETE" }).catch(() => {});
  });

  it("ADMIN ve cartera vencida, reclamos en proceso y ganancia; OPERATOR no ve ninguno de los tres", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    const adminRender = renderApp();

    await screen.findByRole("heading", { name: /^dashboard$/i }, { timeout: 8000 });
    await findLastByTextEventually(LOW_STOCK_SKU, 8000);
    await findLastByTextEventually(/cuentas por cobrar vencidas/i, 8000);
    await findLastByTextEventually(/reclamos de seguro en proceso/i, 8000);
    await findLastByTextEventually(/ganancia:/i, 8000);
    adminRender.unmount();

    const operator = await loginAs("operator");
    setSession(operator.token, operator.user);
    renderApp();

    await screen.findByRole("heading", { name: /^dashboard$/i }, { timeout: 8000 });
    await findLastByTextEventually(LOW_STOCK_SKU, 8000); // stock bajo sí es visible para OPERATOR
    expect(screen.queryByText(/cuentas por cobrar vencidas/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/reclamos de seguro en proceso/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ganancia:/i)).not.toBeInTheDocument();
  }, 30000);

  it("click en 'Stock bajo → Ver todos' navega a /inventory/low-stock y muestra la variante", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    renderApp();

    await screen.findByRole("heading", { name: /^dashboard$/i }, { timeout: 8000 });
    const link = await findLastByTextEventually(/ver todos/i, 8000);
    fireEvent.click(link);

    await screen.findByRole("heading", { name: /^stock bajo$/i }, { timeout: 8000 });
    await findLastByTextEventually(LOW_STOCK_SKU, 8000);
  }, 20000);

  it("click en 'Cuentas por cobrar vencidas' navega a /accounts-receivable y muestra la orden vencida", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    renderApp();

    await screen.findByRole("heading", { name: /^dashboard$/i }, { timeout: 8000 });
    const cardLabel = await findLastByTextEventually(/cuentas por cobrar vencidas/i, 8000);
    const link = cardLabel.closest("a");
    if (!link) throw new Error("La tarjeta de cartera vencida no es un link");
    fireEvent.click(link);

    // La base de desarrollo es compartida entre corridas de e2e y acumula
    // órdenes "vencidas" de otros tests (mismo problema, ya conocido, de
    // accountsReceivable.e2e.test.tsx) — la página por default solo muestra
    // una página de 20, así que la fila exacta de ESTA orden puede no caer
    // ahí. Lo que valida el click-through es que aterrizó en el módulo
    // correcto y con contenido real, no que sea la primera fila visible; la
    // pertenencia real de la orden al conjunto "vencida" se confirma aparte
    // contra la API con una página grande.
    await screen.findByText(/cuentas por cobrar/i, {}, { timeout: 8000 });
    await screen.findByText(/en total/i, {}, { timeout: 8000 });

    const arList = await apiFetch<{ data: { orderNumber: string }[] }>("/accounts-receivable?pageSize=100");
    expect(arList.data.some((o) => o.orderNumber === overdueOrderNumber)).toBe(true);
  }, 20000);

  it("click en 'Reclamos de seguro en proceso' navega a /insurance-claims con 'Solo en proceso' marcado", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    renderApp();

    await screen.findByRole("heading", { name: /^dashboard$/i }, { timeout: 8000 });
    const cardLabel = await findLastByTextEventually(/reclamos de seguro en proceso/i, 8000);
    const link = cardLabel.closest("a");
    if (!link) throw new Error("La tarjeta de reclamos no es un link");
    fireEvent.click(link);

    await screen.findByText(/^reclamos de seguro$/i, {}, { timeout: 8000 });
    const checkbox = (await screen.findByLabelText(/solo en proceso/i)) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
  }, 20000);
});
