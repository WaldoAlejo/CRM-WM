// E2E contra el backend real: calculadora de precios (costo aterrizado → PVP →
// margen), en sus DOS puntos de entrada — inline en un Lote de Importación y
// standalone desde Producto/Variante (última recepción) — y su check de
// persistencia: usar la calculadora NUNCA guarda nada por sí sola.
//
// Se recibe con freightCost=customsCost=otherCosts=0 a propósito: así el
// prorrateo es $0 y el costo aterrizado queda EXACTAMENTE en unitCost=$32.75,
// el mismo número del ejemplo de negocio (incrementos de 70% y 30% → PVP $72.38; descuento
// 30%, 200 unidades → cobro $10,374 / costo $3,900 / ganancia $6,474).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { ImportBatchDetailPage } from "@/features/importBatches/ImportBatchDetailPage";
import { ProductDetailPage } from "@/features/products/ProductDetailPage";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const CREDENTIALS = {
  admin: { email: "admin@kestore.com.ec", password: "Admin123!" },
  ceo: { email: "ceo@kestore.com.ec", password: "Ceo123456!" },
  operator: { email: "operador@kestore.com.ec", password: "Operador123!" },
} as const;
type RoleKey = keyof typeof CREDENTIALS;
const USER_STORAGE_KEY = "wm_kestore_user";

const STAMP = Date.now();
const CATEGORY_NAME = `E2E Pricing Cat ${STAMP}`;
const PRODUCT_SKU = `E2E-PRICING-${STAMP}`;
const VARIANT_SKU = `E2E-PRICING-VAR-${STAMP}`;

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
  return session;
}

function renderApp(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route path="/products/:id" element={<ProductDetailPage />} />
            <Route path="/import-batches/:id" element={<ImportBatchDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Calculadora de precios — de punta a punta contra el backend real", () => {
  let productId: string;
  let variantId: string;
  let batchId: string;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    await signInAs("admin");

    const category = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: CATEGORY_NAME }),
    });
    const product = await apiFetch<{ id: string }>("/products", {
      method: "POST",
      body: JSON.stringify({ sku: PRODUCT_SKU, name: "Producto Calculadora E2E", categoryId: category.id }),
    });
    productId = product.id;
    const variant = await apiFetch<{ id: string }>(`/products/${productId}/variants`, {
      method: "POST",
      body: JSON.stringify({ attributes: { color: "Negro" }, sku: VARIANT_SKU }),
    });
    variantId = variant.id;

    // Ejemplo: $45,000 / 70 CBM; 4.68 CBM para 204 unidades de $18.
    const batch = await apiFetch<{ id: string }>("/import-batches", {
      method: "POST",
      body: JSON.stringify({ reference: `E2E-PRICING-CONT-${STAMP}`, containerType: "40", containerCbm: 70, freightCost: 45000, arrivalDate: new Date().toISOString() }),
    });
    batchId = batch.id;
    await apiFetch(`/import-batches/${batchId}/receive`, {
      method: "POST",
      body: JSON.stringify({ lines: [{ variantId, quantity: 204, volumeCbm: 4.68, unitCost: 18 }] }),
    });
  }, 30000);

  it("inline (Lote de Importación): incrementos de 70% y 30% sugiere PVP $72.38 y el margen replica el ejemplo exacto", async () => {
    await signInAs("admin");
    renderApp(`/import-batches/${batchId}`);

    await screen.findByText(VARIANT_SKU, {}, { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: /calcular pvp/i }));

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("landed-cost").textContent).toBe("$32.75");

    fireEvent.change(within(dialog).getByLabelText(/incremento sobre costo/i), { target: { value: "70" } });
    expect(within(dialog).getByTestId("suggested-pvp").textContent).toBe("$72.38");

    // Simulador de margen — venta a cliente final.
    expect(within(dialog).getByTestId("retail-profit").textContent).toBe("$39.63");

    // Simulador de margen — venta a mayorista: descuento 30%, 200 unidades.
    fireEvent.change(within(dialog).getByLabelText(/incremento sobre mayorista/i), { target: { value: "30" } });
    fireEvent.change(within(dialog).getByLabelText(/cantidad/i), { target: { value: "200" } });
    expect(within(dialog).getByTestId("wholesale-unit-price").textContent).toBe("$55.68");
    expect(within(dialog).getByTestId("wholesale-unit-profit").textContent).toBe("$22.93");
    expect(within(dialog).getByTestId("wholesale-total-charge").textContent).toBe("$11136.00");
    expect(within(dialog).getByTestId("wholesale-total-cost").textContent).toBe("$6550.00");
    expect(within(dialog).getByTestId("wholesale-total-profit").textContent).toBe("$4586.00");
  }, 30000);

  it("'Usar este PVP' NUNCA guarda solo: precarga el formulario del producto y el PVP real sigue igual hasta que se confirma 'Guardar'", async () => {
    await signInAs("admin");

    // Estado real ANTES de tocar nada.
    const before = await apiFetch<{ variants: { id: string; retailPrice: string | null; wholesalePrice: string | null }[] }>(`/products/${productId}`);
    const originalRetailPrice = before.variants.find((v) => v.id === variantId)!.retailPrice;
    expect(originalRetailPrice).toBeNull();

    renderApp(`/import-batches/${batchId}`);
    await screen.findByText(VARIANT_SKU, {}, { timeout: 8000 });
    fireEvent.click(screen.getByRole("button", { name: /calcular pvp/i }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/incremento sobre costo/i), { target: { value: "70" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /usar precios mayorista y pvp/i }));

    // Cruzó a la página del producto y abrió el formulario de edición, PVP
    // prellenado — pero todavía NO guardado (solo un formulario abierto).
    // `hidden: true` porque el título de la página queda aria-hidden mientras
    // el modal de edición está abierto (Radix oculta el fondo para lectores
    // de pantalla, como corresponde) — no es que la navegación haya fallado.
    await screen.findByRole("heading", { name: "Producto Calculadora E2E", hidden: true }, { timeout: 8000 });
    const editDialog = await screen.findByRole("dialog");
    const pvpInput = within(editDialog).getByLabelText(/precio público \(pvp\)/i) as HTMLInputElement;
    expect(pvpInput.value).toBe("72.38");
    expect((within(editDialog).getByLabelText(/^precio mayorista$/i) as HTMLInputElement).value).toBe("55.68");

    const midway = await apiFetch<{ variants: { id: string; retailPrice: string | null; wholesalePrice: string | null }[] }>(`/products/${productId}`);
    expect(midway.variants.find((v) => v.id === variantId)!.retailPrice).toBeNull();

    fireEvent.click(within(editDialog).getByRole("button", { name: /^guardar$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });

    const after = await apiFetch<{ variants: { id: string; retailPrice: string | null; wholesalePrice: string | null }[] }>(`/products/${productId}`);
    expect(Number(after.variants.find((v) => v.id === variantId)!.retailPrice)).toBe(72.38);
    expect(Number(after.variants.find((v) => v.id === variantId)!.wholesalePrice)).toBe(55.68);
  }, 30000);

  it("standalone (Producto/Variante): usa el costo de la última recepción, ofrece los incrementos iniciales de 70% y 30% y persiste solo al confirmar", async () => {
    await signInAs("admin");
    renderApp(`/products/${productId}`);

    await screen.findByRole("heading", { name: "Producto Calculadora E2E" }, { timeout: 8000 });
    const row = (await screen.findByText(VARIANT_SKU)).closest("tr")!;
    fireEvent.click(within(row).getByTitle(/calculadora de precios/i));

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(within(dialog).getByTestId("landed-cost").textContent).toBe("$32.75"), { timeout: 8000 });
    // El PVP guardado en la prueba anterior ($72.38) precarga el markup a 280.
    expect((within(dialog).getByLabelText(/incremento sobre costo/i) as HTMLInputElement).value).toBe("70");
    expect(within(dialog).getByTestId("suggested-pvp").textContent).toBe("$72.38");

    // Cambia de opinión: prueba otro markup dentro de la misma calculadora.
    fireEvent.change(within(dialog).getByLabelText(/incremento sobre costo/i), { target: { value: "80" } });
    expect(within(dialog).getByTestId("suggested-pvp").textContent).toBe("$76.64");
    fireEvent.click(within(dialog).getByRole("button", { name: /usar precios mayorista y pvp/i }));

    const editDialog = await screen.findByRole("dialog");
    expect((within(editDialog).getByLabelText(/precio público \(pvp\)/i) as HTMLInputElement).value).toBe("76.64");

    // Sigue sin persistir hasta este punto…
    const midway = await apiFetch<{ variants: { id: string; retailPrice: string | null; wholesalePrice: string | null }[] }>(`/products/${productId}`);
    expect(Number(midway.variants.find((v) => v.id === variantId)!.retailPrice)).toBe(72.38); // el de la prueba anterior

    fireEvent.click(within(editDialog).getByRole("button", { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // …y cancelar tampoco cambia nada.
    const after = await apiFetch<{ variants: { id: string; retailPrice: string | null; wholesalePrice: string | null }[] }>(`/products/${productId}`);
    expect(Number(after.variants.find((v) => v.id === variantId)!.retailPrice)).toBe(72.38);
  }, 30000);

  it("OPERATOR no ve la calculadora (ni en el lote ni en el producto): expone costos y márgenes reales", async () => {
    await signInAs("operator");

    const batchView = renderApp(`/import-batches/${batchId}`);
    await screen.findByText(VARIANT_SKU, {}, { timeout: 8000 });
    expect(screen.queryByRole("button", { name: /calcular pvp/i })).not.toBeInTheDocument();
    batchView.unmount();

    renderApp(`/products/${productId}`);
    await screen.findByRole("heading", { name: "Producto Calculadora E2E" }, { timeout: 8000 });
    const row = (await screen.findByText(VARIANT_SKU)).closest("tr")!;
    expect(within(row).queryByTitle(/calculadora de precios/i)).not.toBeInTheDocument();
  }, 30000);

  it("CEO (hereda todo lo de ADMIN) sí ve la calculadora en ambos lugares", async () => {
    await signInAs("ceo");

    const batchView = renderApp(`/import-batches/${batchId}`);
    await screen.findByText(VARIANT_SKU, {}, { timeout: 8000 });
    expect(screen.getByRole("button", { name: /calcular pvp/i })).toBeInTheDocument();
    batchView.unmount();

    renderApp(`/products/${productId}`);
    await screen.findByRole("heading", { name: "Producto Calculadora E2E" }, { timeout: 8000 });
    const row = (await screen.findByText(VARIANT_SKU)).closest("tr")!;
    expect(within(row).getByTitle(/calculadora de precios/i)).toBeInTheDocument();
  }, 30000);
});
