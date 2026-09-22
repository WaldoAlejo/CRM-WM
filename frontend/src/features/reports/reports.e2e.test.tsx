// E2E contra el backend real: dashboard con totales/gráfico reales,
// navegación dashboard→detalle preservando el rango de fechas exacto, y la
// sección "ventas con reclamo pendiente" separada y nunca sumada al total.
//
// unitCostSnapshot solo sale real si la variante tuvo un INGRESO de verdad
// (POST /import-batches + /receive) — el endpoint de ajustes manuales usado
// en el resto de este proyecto (/inventory/adjustments) NO fija unitCost,
// así que reportes calculados sobre esas variantes darían costo=0. Se usa
// el flujo real de recepción acá a propósito.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { ProfitabilityDashboardPage } from "./ProfitabilityDashboardPage";
import { ProfitabilityDetailPage } from "./ProfitabilityDetailPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const CATEGORY_NAME = `E2E Reportes Categoría ${Date.now()}`;
const CUSTOMER_NAME = `E2E Cliente Reportes ${Date.now()}`;
const COURIER_NAME = `E2E Courier Reportes ${Date.now()}`;

function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function firstOfMonthISO(): string {
  const now = new Date();
  return toISODate(new Date(now.getFullYear(), now.getMonth(), 1));
}

const FROM = firstOfMonthISO();
const TO = toISODate(new Date());

async function findLastByTextEventually(text: string | RegExp, timeoutMs = 8000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matches = screen.queryAllByText(text);
    if (matches.length > 0) return matches[matches.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No apareció ningún elemento con el texto "${String(text)}" dentro de ${timeoutMs}ms`);
}

function loginAsAdmin() {
  return fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(ADMIN_CREDENTIALS),
  }).then((res) => res.json() as Promise<{ token: string; user: AuthUser }>);
}

function setSession(token: string, user: AuthUser) {
  setToken(token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
}

function renderApp(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/reports" element={<ProfitabilityDashboardPage />} />
            <Route path="/reports/profitability" element={<ProfitabilityDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

async function createVariantWithRealCost(sku: string, unitCost: number, receiveQuantity: number) {
  const category = await apiFetch<{ id: string }>("/categories", {
    method: "POST",
    body: JSON.stringify({ name: `${CATEGORY_NAME} ${sku}` }),
  });
  const product = await apiFetch<{ id: string }>("/products", {
    method: "POST",
    body: JSON.stringify({ sku, name: `Producto ${sku}`, categoryId: category.id }),
  });
  const variant = await apiFetch<{ id: string }>(`/products/${product.id}/variants`, {
    method: "POST",
    body: JSON.stringify({ attributes: { color: "Negro" }, sku: `${sku}-VAR` }),
  });

  const batch = await apiFetch<{ id: string }>("/import-batches", {
    method: "POST",
    body: JSON.stringify({ reference: `E2E-BATCH-${sku}`, arrivalDate: new Date().toISOString(), containerType: "LCL", containerCbm: 1 }),
  });
  await apiFetch(`/import-batches/${batch.id}/receive`, {
    method: "POST",
    body: JSON.stringify({ lines: [{ variantId: variant.id, quantity: receiveQuantity, unitCost, volumeCbm: 1 }] }),
  });

  return { categoryId: category.id, productId: product.id, variantId: variant.id };
}

describe("Reportes de rentabilidad — dashboard + detalle, contra el backend real", () => {
  let customerId: string;
  let courierId: string;
  let soldVariantSku: string;
  let pendingClaimVariantSku: string;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    const admin = await loginAsAdmin();
    if (!admin.token) {
      throw new Error('No se pudo autenticar como admin. ¿Corriste "npx prisma db seed" en backend/?');
    }
    setSession(admin.token, admin.user);

    const customer = await apiFetch<{ id: string }>("/final-customers", {
      method: "POST",
      body: JSON.stringify({ fullName: CUSTOMER_NAME, idType: "CEDULA", idNumber: `${Date.now()}` }),
    });
    customerId = customer.id;

    const courier = await apiFetch<{ id: string }>("/couriers", {
      method: "POST",
      body: JSON.stringify({ name: COURIER_NAME }),
    });
    courierId = courier.id;

    // Venta CONFIRMADA real: unitCost=10, quantity=2, unitPrice=25 ->
    // revenue=50, cost=20, profit=30, margin=60%.
    soldVariantSku = `E2E-REP-SOLD-${Date.now()}`;
    const sold = await createVariantWithRealCost(soldVariantSku, 10, 20);
    const soldOrder = await apiFetch<{ id: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "CLIENTE_FINAL",
        finalCustomerId: customerId,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CONTADO",
        items: [{ variantId: sold.variantId, quantity: 2, priceType: "PVP", unitPrice: 25 }],
      }),
    });
    await apiFetch(`/dispatch-orders/${soldOrder.id}/confirm`, { method: "POST", body: JSON.stringify({}) });

    // Venta con reclamo PENDIENTE: unitCost=8, quantity=1, unitPrice=40 ->
    // NO debe sumar al total principal hasta que el reclamo se pague.
    pendingClaimVariantSku = `E2E-REP-PEND-${Date.now()}`;
    const pending = await createVariantWithRealCost(pendingClaimVariantSku, 8, 20);
    const pendingOrder = await apiFetch<{ id: string }>("/dispatch-orders", {
      method: "POST",
      body: JSON.stringify({
        buyerType: "CLIENTE_FINAL",
        finalCustomerId: customerId,
        shippingProvince: "Pichincha",
        shippingCity: "Quito",
        paymentMethod: "CONTRA_ENTREGA",
        items: [{ variantId: pending.variantId, quantity: 1, priceType: "PVP", unitPrice: 40 }],
      }),
    });
    const confirmedPending = await apiFetch<{ shipment: { id: string } }>(
      `/dispatch-orders/${pendingOrder.id}/confirm`,
      { method: "POST", body: JSON.stringify({ courierId, trackingNumber: "GUIA-REP" }) }
    );
    await apiFetch(`/shipments/${confirmedPending.shipment.id}/lost-or-damaged`, {
      method: "POST",
      body: JSON.stringify({ status: "PERDIDO" }),
    });
  }, 30000);

  it("el dashboard sin filtros en la URL se autocompleta con el mes calendario actual", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    renderApp("/reports");

    await screen.findByText(/rentabilidad/i);
    const fromInput = (await screen.findByLabelText(/^desde$/i)) as HTMLInputElement;
    const toInput = (await screen.findByLabelText(/^hasta$/i)) as HTMLInputElement;

    expect(fromInput.value).toBe(FROM);
    expect(toInput.value).toBe(TO);
  }, 15000);

  it("el dashboard muestra totales reales (incluye la venta confirmada, no la pendiente de reclamo) y el gráfico renderiza sin crashear", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    const { container } = renderApp(`/reports?from=${FROM}&to=${TO}`);

    await screen.findByText(/rentabilidad/i);

    const apiSummary = await apiFetch<{
      totals: { totalRevenue: string; totalCost: string; profit: string; profitMarginPct: string };
    }>(`/reports/profitability/summary?dateFrom=${FROM}&dateTo=${TO}`);

    await findLastByTextEventually(`$${apiSummary.totals.totalRevenue}`, 8000);
    await findLastByTextEventually(`$${apiSummary.totals.profit}`, 8000);

    // El gráfico no crashea: si recharts hubiera tirado una excepción al
    // renderizar, render() ya habría fallado antes de llegar acá (esto
    // ya lo prueba el findByText de "rentabilidad" más arriba, dado que
    // CategoryProfitChart está en el mismo árbol). Se confirma además que
    // pintó un <svg> real, y que el nombre de la categoría vendida aparece
    // en el HTML servido — vía innerHTML, no queries de testing-library:
    // recharts puede partir textos largos del eje Y en varios <tspan>, y
    // eso rompe una búsqueda de texto EXACTO sobre un solo nodo aunque el
    // contenido esté ahí. byCategory no tiene límite de 10 como
    // topProductsByProfit, así que esto no depende de cuánta otra data
    // histórica exista ya este mes en esta base compartida.
    await waitFor(() => expect(container.querySelector("svg.recharts-surface")).toBeTruthy(), { timeout: 8000 });
    const soldCategoryName = `${CATEGORY_NAME} ${soldVariantSku}`;
    await waitFor(() => expect(container.innerHTML.includes(soldCategoryName)).toBe(true), { timeout: 8000 });

    // La venta pendiente de reclamo NO debe aparecer en ningún lado del
    // dashboard (el summary ni siquiera la trae del backend) — esta
    // aserción negativa no depende de rankings ni de cuánta data histórica
    // haya, así que es segura tal cual.
    expect(screen.queryByText(new RegExp(pendingClaimVariantSku))).not.toBeInTheDocument();
  }, 20000);

  it("Ver detalle preserva el rango de fechas exacto de la URL", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    renderApp(`/reports?from=${FROM}&to=${TO}`);
    await screen.findByText(/rentabilidad/i);

    const link = (await screen.findByRole("link", { name: /ver detalle/i })) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe(`/reports/profitability?from=${FROM}&to=${TO}`);

    fireEvent.click(link);

    await screen.findByText(/detalle por producto/i);
    const fromInput = (await screen.findByLabelText(/^desde$/i)) as HTMLInputElement;
    const toInput = (await screen.findByLabelText(/^hasta$/i)) as HTMLInputElement;
    expect(fromInput.value).toBe(FROM);
    expect(toInput.value).toBe(TO);
  }, 15000);

  it("el detalle separa 'ventas con reclamo pendiente' de las ventas confirmadas, sin sumarla al total principal", async () => {
    const admin = await loginAsAdmin();
    setSession(admin.token, admin.user);

    renderApp(`/reports/profitability?from=${FROM}&to=${TO}`);
    await screen.findByText(/detalle por producto/i);

    const apiReport = await apiFetch<{
      totals: { totalRevenue: string };
      ventasConReclamoPendiente: { totals: { totalRevenue: string } };
    }>(`/reports/profitability?dateFrom=${FROM}&dateTo=${TO}`);

    // La venta confirmada SÍ está en la tabla principal.
    await findLastByTextEventually(new RegExp(soldVariantSku), 8000);

    // La venta con reclamo pendiente aparece en su SECCIÓN PROPIA... (el
    // substring del SKU aparece dos veces: en la celda SKU y en la celda
    // Producto, que lo repite como parte del nombre — getAllByText, no
    // getByText).
    const pendingHeading = await findLastByTextEventually(/ventas con reclamo pendiente/i, 8000);
    const pendingSection = pendingHeading.closest("section");
    if (!pendingSection) throw new Error("No se encontró la sección de ventas con reclamo pendiente");
    expect(within(pendingSection).getAllByText(new RegExp(pendingClaimVariantSku)).length).toBeGreaterThan(0);

    // ...y NUNCA dentro de la tabla principal de ventas.
    const mainSalesHeading = screen.getByText("Ventas");
    const mainSalesSection = mainSalesHeading.closest("section");
    if (!mainSalesSection) throw new Error("No se encontró la sección de ventas confirmadas");
    expect(within(mainSalesSection).queryByText(new RegExp(pendingClaimVariantSku))).not.toBeInTheDocument();

    // El total principal mostrado en pantalla es el mismo que devuelve la
    // API para `totals` (nunca el de ventasConReclamoPendiente, y nunca la
    // suma de los dos) — se confirma que el revenue pendiente es un número
    // real y DISTINTO del total principal, para que esta aserción no sea
    // trivial si algún día ambos coincidieran por casualidad.
    expect(Number(apiReport.ventasConReclamoPendiente.totals.totalRevenue)).toBeGreaterThan(0);
    expect(apiReport.totals.totalRevenue).not.toBe(apiReport.ventasConReclamoPendiente.totals.totalRevenue);
    await findLastByTextEventually(`$${apiReport.totals.totalRevenue}`, 8000);
  }, 20000);
});
