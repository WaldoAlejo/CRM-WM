// E2E contra el backend real: listado (ProductsPage) -> crear producto (con
// el formulario real, incluye categoría) -> aparece en la tabla -> abrir el
// detalle -> editar -> cambiar de categoría dispara el gate de "reconfirmá
// la subcategoría" DEL LADO DEL CLIENTE (ProductFormDialog), sin llegar a
// pegarle al backend con un body incompleto -> reconfirmar sí deja guardar
// -> eliminar.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import { ProductDetailPage } from "./ProductDetailPage";
import { ProductsPage } from "./ProductsPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const SKU = `E2E-${Date.now()}`;
const NAME = `E2E Producto ${Date.now()}`;
const CATEGORY_A_NAME = `E2E Categoría A ${Date.now()}`;
const CATEGORY_B_NAME = `E2E Categoría B ${Date.now()}`;

// El contenido del <Select> de Radix vive en un Portal (fuera del árbol de
// React normal), montado/desmontado con cada apertura. screen.findByText, en
// esta combinación puntual de happy-dom + Portal + reapertura rápida, se
// mostró inconsistente entre dos fallas DISTINTAS (a veces "no encontrado",
// a veces "más de uno encontrado" — un doble-render transitorio del
// contenido del portal, no datos duplicados: confirmado con el backend real
// mostrando una sola categoría con ese nombre en ambos casos). Un polling
// manual con temporizador real + quedarse con el ÚLTIMO match evita las dos
// fallas a la vez, sin necesidad de diagnosticar más a fondo un detalle de
// implementación de Radix/happy-dom que no tiene que ver con el código de la app.
async function findLastByTextEventually(text: string, timeoutMs = 8000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matches = screen.queryAllByText(text);
    if (matches.length > 0) return matches[matches.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No apareció ningún elemento con el texto "${text}" dentro de ${timeoutMs}ms`);
}

function renderProductsPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={["/products"]}>
          <ProductsPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

function renderDetailPage(id: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[`/products/${id}`]}>
          <Routes>
            <Route path="/products/:id" element={<ProductDetailPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Products — listado + crear + editar (reconfirmar subcategoría) + eliminar, contra el backend real", () => {
  let categoryAId: string;
  let categoryBId: string;
  let subcategoryAId: string;
  let subcategoryBId: string;
  let createdProductId: string | undefined;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ADMIN_CREDENTIALS),
    });
    if (!loginRes.ok) {
      throw new Error(
        'No se pudo autenticar con las credenciales de seed. ¿Corriste "npx prisma db seed" en backend/?'
      );
    }
    const { token, user } = (await loginRes.json()) as { token: string; user: unknown };
    setToken(token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));

    // 2 categorías propias de este test (no depende de que el seed tenga
    // exactamente "Cocina"/"Seguridad" con esos nombres). Nombres únicos por
    // corrida Y usados con match EXACTO más abajo (no un prefijo suelto):
    // si una corrida anterior dejó basura sin limpiar, un prefijo compartido
    // ("E2E Categoría A...") encuentra varias opciones y explota por
    // ambigüedad — el nombre completo con timestamp es siempre único.
    const catA = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: CATEGORY_A_NAME }),
    });
    categoryAId = catA.id;
    const catB = await apiFetch<{ id: string }>("/categories", {
      method: "POST",
      body: JSON.stringify({ name: CATEGORY_B_NAME }),
    });
    categoryBId = catB.id;
    const subA = await apiFetch<{ id: string }>(`/categories/${categoryAId}/subcategories`, {
      method: "POST",
      body: JSON.stringify({ name: "E2E Subcategoría A1" }),
    });
    subcategoryAId = subA.id;
    // Categoría B también necesita al menos una subcategoría propia: si no
    // tuviera ninguna, el Select de subcategoría queda disabled en el
    // formulario y el test de reconfirmación estaría probando el caso
    // trivial (nada que reconfirmar), no el gate real de "elegí qué pasa
    // con la subcategoría".
    const subB = await apiFetch<{ id: string }>(`/categories/${categoryBId}/subcategories`, {
      method: "POST",
      body: JSON.stringify({ name: "E2E Subcategoría B1" }),
    });
    subcategoryBId = subB.id;
  });

  afterAll(async () => {
    if (createdProductId) await apiFetch(`/products/${createdProductId}`, { method: "DELETE" }).catch(() => {});
    // Las categorías no se pueden borrar mientras les quede una subcategoría
    // activa (Category.softDelete bloquea igual que Brand con productos) —
    // hay que borrar las subcategorías primero. Esto era justamente lo que
    // dejaba categorías huérfanas acumulándose en corridas anteriores.
    await apiFetch(`/subcategories/${subcategoryAId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/subcategories/${subcategoryBId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/categories/${categoryAId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/categories/${categoryBId}`, { method: "DELETE" }).catch(() => {});
  });

  it("crea un producto desde el formulario real y aparece en la tabla", async () => {
    renderProductsPage();

    fireEvent.click(await screen.findByRole("button", { name: /nuevo producto/i }));

    const dialog = await screen.findByRole("dialog");

    fireEvent.change(await within(dialog).findByPlaceholderText("Ej: WM-0012"), { target: { value: SKU } });
    fireEvent.change(within(dialog).getByPlaceholderText("Ej: Freidora de aire WM"), { target: { value: NAME } });

    // Categoría: Radix Select no es un <select> nativo, se interactúa por
    // rol. Escopado al dialog: la página de fondo (ProductsPage) TAMBIÉN
    // tiene un combobox "Categoría" (el filtro), con "categoría" como
    // substring de su propio texto ("Todas las categorías") — sin escopar,
    // getByRole encuentra los dos y explota por ambigüedad.
    fireEvent.click(within(dialog).getByRole("combobox", { name: /^categoría$/i }));
    fireEvent.click(await findLastByTextEventually(CATEGORY_A_NAME));

    fireEvent.click(within(dialog).getByRole("button", { name: /^guardar$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });
    await screen.findByText(NAME, {}, { timeout: 8000 });

    const list = await apiFetch<{ data: { id: string; sku: string }[] }>("/products?pageSize=100");
    createdProductId = list.data.find((p) => p.sku === SKU)?.id;
    expect(createdProductId).toBeTruthy();
  }, 30000);

  it("en el detalle: cambiar de categoría con subcategoría ya asignada bloquea el guardado hasta reconfirmar", async () => {
    expect(createdProductId).toBeTruthy();

    // Le asigna subcategoría directo por API — el foco es el gate del
    // FORMULARIO, no repetir el flujo de creación.
    await apiFetch(`/products/${createdProductId}`, {
      method: "PATCH",
      body: JSON.stringify({ subcategoryId: subcategoryAId }),
    });

    renderDetailPage(createdProductId!);
    fireEvent.click(await screen.findByRole("button", { name: /editar/i }, { timeout: 8000 }));

    fireEvent.click(await screen.findByRole("combobox", { name: /^categoría$/i }));
    fireEvent.click(await findLastByTextEventually(CATEGORY_B_NAME));

    // Intenta guardar SIN tocar la subcategoría: el dialog debe seguir
    // abierto (bloqueado del lado del cliente, nunca llegó a mandar el PATCH).
    fireEvent.click(screen.getByRole("button", { name: /^guardar$/i }));
    await screen.findByText(/reconfirmá la subcategoría|elegí una/i, {}, { timeout: 4000 });
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    // Reconfirma explícitamente "Sin subcategoría" -> ahora sí debe guardar.
    fireEvent.click(screen.getByRole("combobox", { name: /subcategoría/i }));
    fireEvent.click(await findLastByTextEventually("Sin subcategoría"));
    fireEvent.click(screen.getByRole("button", { name: /^guardar$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });

    const updated = await apiFetch<{ categoryId: string; subcategoryId: string | null }>(
      `/products/${createdProductId}`
    );
    expect(updated.categoryId).toBe(categoryBId);
    expect(updated.subcategoryId).toBeNull();
  }, 30000);
});
