// E2E contra el backend real: variantes de un producto — atributos dinámicos
// (crear con 2+ atributos y verificar el label calculado), bloqueo de claves
// de atributo repetidas (sin perder datos en silencio), ocultamiento de
// precios/costos por rol (ni en el formulario ni en las columnas de la
// tabla — ausentes del DOM, no deshabilitados), y subida/rechazo de
// imágenes (el mensaje real del backend debe llegar a un toast visible).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { fetch as undiciFetch, FormData as UndiciFormData } from "undici";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { ProductDetailPage } from "./ProductDetailPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;
// happy-dom's global FormData no interopera con el fetch de undici: un
// archivo adjuntado a través de un <input type="file"> (happy-dom's File)
// dentro de un happy-dom FormData llega al backend como si no se hubiera
// adjuntado nada (confirmado con un probe manual — el multer del backend
// respondía "Debes adjuntar un archivo de imagen"). Usando la clase
// FormData de undici (misma librería que el fetch ya reemplazado) el mismo
// happy-dom File SÍ viaja correcto. Esto es un detalle del entorno de
// pruebas (happy-dom + undici), no del código de la app — un browser real
// nunca tiene este problema, porque su fetch y su FormData son del mismo
// realm.
globalThis.FormData = UndiciFormData as unknown as typeof FormData;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const OPERATOR_CREDENTIALS = { email: "operador@kestore.com.ec", password: "Operador123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const CATEGORY_NAME = `E2E Var Categoría ${Date.now()}`;
const PRODUCT_SKU = `E2E-VAR-${Date.now()}`;
const PRODUCT_NAME = `E2E Producto para variantes ${Date.now()}`;

// 1x1 PNG transparente real — para probar la subida exitosa (necesita ser un
// archivo válido de verdad, el backend valida el mime type, no solo la
// extensión).
const PNG_1X1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function pngFile(name = "test.png"): File {
  const bytes = Uint8Array.from(atob(PNG_1X1_BASE64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: "image/png" });
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

// Mismo problema de Radix Select + Portal + happy-dom documentado en
// products.e2e.test.tsx: un polling manual con temporizador real, tolerante
// a "no encontrado todavía" y a matches transitorios múltiples, evita las
// dos fallas sin tener que diagnosticar más a fondo un detalle de Radix.
async function findLastByTextEventually(text: string | RegExp, timeoutMs = 8000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matches = screen.queryAllByText(text);
    if (matches.length > 0) return matches[matches.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No apareció ningún elemento con el texto "${String(text)}" dentro de ${timeoutMs}ms`);
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

describe("Variantes — atributos, precios por rol e imágenes, contra el backend real", () => {
  let categoryId: string;
  let productId: string;
  const createdVariantIds: string[] = [];

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
      body: JSON.stringify({ sku: PRODUCT_SKU, name: PRODUCT_NAME, categoryId }),
    });
    productId = product.id;
  });

  afterAll(async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    for (const variantId of createdVariantIds) {
      await apiFetch(`/variants/${variantId}`, { method: "DELETE" }).catch(() => {});
    }
    if (productId) await apiFetch(`/products/${productId}`, { method: "DELETE" }).catch(() => {});
    if (categoryId) await apiFetch(`/categories/${categoryId}`, { method: "DELETE" }).catch(() => {});
  });

  it("crea una variante con 2 atributos y calcula el label a partir de sus valores", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    renderDetailPage(productId);

    fireEvent.click(await screen.findByRole("button", { name: /nueva variante/i }, { timeout: 8000 }));
    const dialog = await screen.findByRole("dialog");

    const keyInputs = within(dialog).getAllByPlaceholderText("Ej: color");
    const valueInputs = within(dialog).getAllByPlaceholderText("Ej: Negro");
    fireEvent.change(keyInputs[0], { target: { value: "Color" } });
    fireEvent.change(valueInputs[0], { target: { value: "Rojo" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /agregar atributo/i }));
    const keyInputs2 = within(dialog).getAllByPlaceholderText("Ej: color");
    const valueInputs2 = within(dialog).getAllByPlaceholderText("Ej: Negro");
    fireEvent.change(keyInputs2[1], { target: { value: "Talla" } });
    fireEvent.change(valueInputs2[1], { target: { value: "M" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /^guardar$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });
    await findLastByTextEventually("Rojo / M");

    const detail = await apiFetch<{ variants: { id: string; label: string | null; attributes: Record<string, string> }[] }>(
      `/products/${productId}`
    );
    const created = detail.variants.find((v) => v.label === "Rojo / M");
    expect(created).toBeTruthy();
    expect(created?.attributes).toEqual({ Color: "Rojo", Talla: "M" });
    if (created) createdVariantIds.push(created.id);
  }, 30000);

  it("bloquea claves de atributo repetidas (case-insensitive) sin dejar guardar ni perder datos en silencio", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    renderDetailPage(productId);

    fireEvent.click(await screen.findByRole("button", { name: /nueva variante/i }, { timeout: 8000 }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getAllByPlaceholderText("Ej: color")[0], { target: { value: "Color" } });
    fireEvent.change(within(dialog).getAllByPlaceholderText("Ej: Negro")[0], { target: { value: "Azul" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /agregar atributo/i }));
    fireEvent.change(within(dialog).getAllByPlaceholderText("Ej: color")[1], { target: { value: "color" } });
    fireEvent.change(within(dialog).getAllByPlaceholderText("Ej: Negro")[1], { target: { value: "Verde" } });

    const variantCountBefore = (await apiFetch<{ variants: unknown[] }>(`/products/${productId}`)).variants.length;

    fireEvent.click(within(dialog).getByRole("button", { name: /^guardar$/i }));

    await findLastByTextEventually(/repetida/i);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    const variantCountAfter = (await apiFetch<{ variants: unknown[] }>(`/products/${productId}`)).variants.length;
    expect(variantCountAfter).toBe(variantCountBefore);
  }, 30000);

  it("ADMIN ve los campos y columnas de precio; OPERATOR no los ve en absoluto (ausentes del DOM, no deshabilitados)", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    const adminRender = renderDetailPage(productId);

    fireEvent.click(await screen.findByRole("button", { name: /nueva variante/i }, { timeout: 8000 }));
    const adminDialog = await screen.findByRole("dialog");
    expect(within(adminDialog).getByText(/costo de fábrica/i)).toBeInTheDocument();
    expect(within(adminDialog).queryByText(/precio público/i)).not.toBeInTheDocument();
    expect(screen.getByText(/costo \(usd\)/i)).toBeInTheDocument();
    expect(screen.queryByText(/^pvp$/i)).not.toBeInTheDocument();
    // Desmonta explícitamente antes de renderizar la segunda vez en el MISMO
    // test: el cleanup automático de testing-library corre entre tests
    // (afterEach), no entre dos render() dentro del mismo it — sin esto,
    // quedarían dos árboles montados a la vez y las queries de más abajo
    // encontrarían elementos duplicados.
    adminRender.unmount();

    const operator = await loginAs("operator");
    setSession(operator.token, operator.user);
    renderDetailPage(productId);

    fireEvent.click(await screen.findByRole("button", { name: /nueva variante/i }, { timeout: 8000 }));
    const operatorDialog = await screen.findByRole("dialog");
    expect(within(operatorDialog).queryByText(/costo de fábrica/i)).not.toBeInTheDocument();
    expect(within(operatorDialog).queryByText(/precio público/i)).not.toBeInTheDocument();
    expect(within(operatorDialog).queryByText(/precios y costos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/costo \(usd\)/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^pvp$/i)).not.toBeInTheDocument();
  }, 30000);

  it("sube una imagen válida a una variante y rechaza un .txt con el mensaje real del backend en un toast", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    const detailBefore = await apiFetch<{ variants: { id: string }[] }>(`/products/${productId}`);
    const variantId = detailBefore.variants[0]?.id;
    expect(variantId).toBeTruthy();

    renderDetailPage(productId);

    // Sin timeout explícito acá, el default de findAllByRole (~1000ms) queda
    // corto contra un backend real: esta es la 4ta prueba del archivo, con
    // varias requests reales ya hechas antes — el fetch de detalle puede
    // tardar más de 1s sin que sea un cuelgue real (confirmado con debug: a
    // los 3s ya estaba resuelto).
    const rows = await screen.findAllByRole("row", {}, { timeout: 15000 });
    // La primera fila es el header; las de datos empiezan en el índice 1.
    fireEvent.click(within(rows[1]).getByTitle(/imágenes/i));

    const imagesDialog = await screen.findByRole("dialog");
    const fileInput = imagesDialog.querySelector('input[type="file"]');
    expect(fileInput).toBeTruthy();

    // Subida válida: debe reflejarse como una imagen nueva en el grid real
    // (verificado contra el backend, no solo el DOM).
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [pngFile()] } });

    await waitFor(
      async () => {
        const detail = await apiFetch<{ variants: { id: string; images: unknown[] }[] }>(`/products/${productId}`);
        const variant = detail.variants.find((v) => v.id === variantId);
        expect(variant?.images.length).toBeGreaterThan(0);
      },
      { timeout: 8000 }
    );

    // Rechazo: un .txt debe llegar a un toast VISIBLE con el mensaje exacto
    // del backend, no quedarse solo en la consola.
    const toastErrorSpy = vi.spyOn(toast, "error");
    const txtFile = new File(["esto no es una imagen"], "documento.txt", { type: "text/plain" });
    fireEvent.change(fileInput as HTMLInputElement, { target: { files: [txtFile] } });

    await waitFor(
      () =>
        expect(toastErrorSpy).toHaveBeenCalledWith(
          expect.stringContaining("Formato de imagen no permitido (solo JPEG, PNG o WEBP)")
        ),
      { timeout: 8000 }
    );

    toastErrorSpy.mockRestore();
  }, 30000);
});
