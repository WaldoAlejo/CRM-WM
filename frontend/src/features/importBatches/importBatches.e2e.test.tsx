// E2E contra el backend real: crear lote + recibir desde el formulario real
// (con vista previa de prorrateo), verificar el stock por ubicación, recibir
// una segunda tanda sobre el mismo lote, y la vista de OPERATOR (sin costos).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { CreateImportBatchPage } from "./CreateImportBatchPage";
import { ImportBatchDetailPage } from "./ImportBatchDetailPage";
import { ImportBatchesPage } from "./ImportBatchesPage";
import { ReceiveStockPage } from "./ReceiveStockPage";
import { landedUnitCost, prorationPerUnit, totalBatchCost } from "./landedCost";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const OPERATOR_CREDENTIALS = { email: "operador@kestore.com.ec", password: "Operador123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const STAMP = Date.now();
const CATEGORY_NAME = `E2E Imp Categoría ${STAMP}`;
const PRODUCT_SKU = `E2E-IMP-${STAMP}`;
const VARIANT_SKU = `E2E-IMP-VAR-${STAMP}`;
const SUPPLIER_NAME = `E2E Imp Proveedor ${STAMP}`;
const WAREHOUSE_NAME = `E2E Imp Bodega ${STAMP}`;
const LOCATION_CODE = `IMP-${STAMP}`;
const REFERENCE = `E2E-CONT-${STAMP}`;
const LOCATION_LABEL = `${WAREHOUSE_NAME} · ${LOCATION_CODE}`;

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

function renderApp(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/import-batches" element={<ImportBatchesPage />} />
            <Route path="/import-batches/new" element={<CreateImportBatchPage />} />
            <Route path="/import-batches/:id" element={<ImportBatchDetailPage />} />
            <Route path="/import-batches/:id/receive" element={<ReceiveStockPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

async function addLine(quantity: string, unitCost: string) {
  fireEvent.change(screen.getByPlaceholderText(/buscar por sku, nombre o código de barras/i), {
    target: { value: VARIANT_SKU },
  });
  fireEvent.click(await findLastByTextEventually(new RegExp(VARIANT_SKU)));
  fireEvent.change(await screen.findByLabelText(`Cantidad ${VARIANT_SKU}`), { target: { value: quantity } });
  fireEvent.change(screen.getByLabelText(`Costo unitario ${VARIANT_SKU}`), { target: { value: unitCost } });
  fireEvent.click(screen.getByRole("combobox", { name: `Ubicación ${VARIANT_SKU}` }));
  fireEvent.click(await findLastByTextEventually(LOCATION_LABEL));
}

describe("Importaciones — lote → recepción → stock por ubicación, contra el backend real", () => {
  let categoryId: string;
  let productId: string;
  let variantId: string;
  let supplierId: string;
  let warehouseId: string;
  let locationId: string;
  let batchId: string;

  async function netStockAtLocation(): Promise<number> {
    const res = await apiFetch<{ data: { variantId: string; netStock: number }[] }>(
      `/inventory/stock-by-location?locationId=${locationId}&variantId=${variantId}`
    );
    return res.data.find((r) => r.variantId === variantId)?.netStock ?? 0;
  }

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    categoryId = (
      await apiFetch<{ id: string }>("/categories", { method: "POST", body: JSON.stringify({ name: CATEGORY_NAME }) })
    ).id;
    productId = (
      await apiFetch<{ id: string }>("/products", {
        method: "POST",
        body: JSON.stringify({ sku: PRODUCT_SKU, name: "Producto Importación E2E", categoryId }),
      })
    ).id;
    variantId = (
      await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
        method: "POST",
        body: JSON.stringify({ attributes: { color: "Verde" }, sku: VARIANT_SKU }),
      })
    ).id;
    supplierId = (
      await apiFetch<{ id: string }>("/suppliers", { method: "POST", body: JSON.stringify({ name: SUPPLIER_NAME }) })
    ).id;
    warehouseId = (
      await apiFetch<{ id: string }>("/warehouses", { method: "POST", body: JSON.stringify({ name: WAREHOUSE_NAME }) })
    ).id;
    locationId = (
      await apiFetch<{ id: string }>(`/warehouses/${warehouseId}/locations`, {
        method: "POST",
        body: JSON.stringify({ code: LOCATION_CODE }),
      })
    ).id;
  }, 30000);

  afterAll(async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    const remaining = await netStockAtLocation().catch(() => 0);
    if (remaining > 0) {
      await apiFetch("/inventory/adjustments", {
        method: "POST",
        body: JSON.stringify({ variantId, quantity: -remaining, reason: "E2E cleanup", locationId }),
      }).catch(() => {});
    }
    await apiFetch(`/variants/${variantId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/suppliers/${supplierId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/locations/${locationId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/warehouses/${warehouseId}`, { method: "DELETE" }).catch(() => {});
  });

  it("ADMIN: crea el lote desde el formulario, ve el prorrateo en vivo, recibe con ubicación y el stock por ubicación sube", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    renderApp("/import-batches/new");

    fireEvent.change(await screen.findByLabelText(/referencia/i), { target: { value: REFERENCE } });
    fireEvent.change(screen.getByLabelText(/flete internacional/i), { target: { value: "30" } });
    fireEvent.change(screen.getByLabelText(/aranceles/i), { target: { value: "20" } });
    fireEvent.change(screen.getByLabelText(/otros costos/i), { target: { value: "10" } });

    // El buscador (Popover) va ANTES de abrir el <Select> de proveedor: un
    // Select de Radix recién usado deja capas abiertas en happy-dom que
    // impiden que el Popover del buscador vuelva a abrirse (mismo tipo de
    // detalle que ya se documentó en products.e2e.test.tsx).
    await addLine("10", "5");

    fireEvent.click(screen.getByRole("combobox", { name: /proveedor/i }));
    fireEvent.click(await findLastByTextEventually(SUPPLIER_NAME));

    // Vista previa en vivo: (30+20+10) / 10 unidades = $6.00 por unidad;
    // costo puesto = 5 + 6 = $11.00.
    const preview = await screen.findByTestId("landed-cost-preview");
    expect(preview.textContent).toContain("$60.00");
    expect(preview.textContent).toContain("$6.00");
    await findLastByTextEventually("$11.00");

    fireEvent.click(screen.getByRole("button", { name: /crear lote y recibir/i }));

    // Navega al detalle del lote recién creado y recibido.
    await screen.findByRole("heading", { name: REFERENCE }, { timeout: 10000 });
    await findLastByTextEventually("Recibido");
    await findLastByTextEventually(LOCATION_LABEL);

    const list = await apiFetch<{ data: { id: string; reference: string }[] }>("/import-batches?pageSize=100");
    batchId = list.data.find((b) => b.reference === REFERENCE)!.id;
    expect(batchId).toBeTruthy();

    // Lo que calculó el servidor coincide con la vista previa.
    const detail = await apiFetch<{
      movements: { quantity: number; unitCost: string; landedCostPerUnit: string; toLocationId: string }[];
    }>(`/import-batches/${batchId}`);
    expect(detail.movements).toHaveLength(1);
    const proration = prorationPerUnit(totalBatchCost({ freightCost: 30, customsCost: 20, otherCosts: 10 }), 10);
    expect(Number(detail.movements[0].landedCostPerUnit)).toBe(proration);
    expect(landedUnitCost(5, proration)).toBe(11);
    expect(detail.movements[0].toLocationId).toBe(locationId);

    expect(await netStockAtLocation()).toBe(10);
  }, 45000);

  it("segunda tanda sobre el mismo lote: prorratea solo entre SUS unidades y suma al stock de la ubicación", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    renderApp(`/import-batches/${batchId}/receive`);

    await screen.findByRole("heading", { name: new RegExp(REFERENCE) }, { timeout: 8000 });
    await addLine("5", "4");
    // 60 / 5 unidades = $12.00 por unidad en ESTA tanda.
    const preview = await screen.findByTestId("landed-cost-preview");
    expect(preview.textContent).toContain("$12.00");

    fireEvent.click(screen.getByRole("button", { name: /^recibir mercadería$/i }));
    await screen.findByRole("heading", { name: REFERENCE }, { timeout: 10000 });

    const detail = await apiFetch<{ movements: { quantity: number; landedCostPerUnit: string }[] }>(
      `/import-batches/${batchId}`
    );
    expect(detail.movements).toHaveLength(2);
    expect(Number(detail.movements.find((m) => m.quantity === 5)!.landedCostPerUnit)).toBe(12);
    expect(await netStockAtLocation()).toBe(15);
  }, 45000);

  it("OPERATOR: puede recibir mercadería, pero no ve costos del lote, vista previa ni costos en listado/detalle", async () => {
    const operator = await loginAs("operator");
    setSession(operator.token, operator.user);

    const formRender = renderApp("/import-batches/new");
    await screen.findByLabelText(/referencia/i);
    expect(screen.queryByLabelText(/flete internacional/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("landed-cost-preview")).not.toBeInTheDocument();
    formRender.unmount();

    // La base de desarrollo es compartida y acumula lotes de otros e2e (que
    // dejan el mío fuera de la primera página de 20): se filtra por el
    // proveedor propio de esta corrida.
    const listRender = renderApp("/import-batches");
    fireEvent.click(await screen.findByRole("combobox", { name: /filtrar por proveedor/i }));
    fireEvent.click(await findLastByTextEventually(SUPPLIER_NAME));
    await findLastByTextEventually(REFERENCE);
    expect(screen.queryByText(/costos del lote/i)).not.toBeInTheDocument();
    listRender.unmount();

    renderApp(`/import-batches/${batchId}`);
    await screen.findByRole("heading", { name: REFERENCE }, { timeout: 8000 });
    await findLastByTextEventually(LOCATION_LABEL);
    expect(screen.queryByText(/costo en origen/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/total puesto en bodega/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/prorrateo/i)).not.toBeInTheDocument();
    // Lo operativo sí se ve: unidades recibidas (10 + 5).
    await findLastByTextEventually("15");
  }, 30000);
});
