// E2E contra el backend real: el formulario de Bodegas con su selector de
// responsable (WarehouseFormDialog) — crear con capacity/phone/notes/manager,
// editar limpiando el responsable, permisos de OPERATOR, y — de punta a
// punta, no solo a nivel backend — que desactivar al responsable de una
// bodega ACTIVA queda bloqueado (409) hasta reasignarlo.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { WarehousesPage } from "./WarehousesPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const CREDENTIALS = {
  admin: { email: "admin@kestore.com.ec", password: "Admin123!" },
  operator: { email: "operador@kestore.com.ec", password: "Operador123!" },
} as const;
type RoleKey = keyof typeof CREDENTIALS;
const USER_STORAGE_KEY = "wm_kestore_user";

const STAMP = Date.now();
const WAREHOUSE_NAME = `E2E Bodega Form ${STAMP}`;
const MANAGER_NAME = `E2E Responsable Form ${STAMP}`;

// Mismo problema que ya documentó users.e2e.test.tsx para un Select anidado
// DENTRO de un Dialog, pero acá hace falta ir un poco más allá que "tomar el
// último match": Radix Select además renderiza un <select><option> NATIVO
// oculto (espejo, para autocompletar del navegador) con el MISMO texto que
// cada opción visible — un simple fireEvent.click sobre ese <option> no
// selecciona nada (los <option> no reciben clicks como un elemento normal).
// Se filtra explícitamente por tagName para nunca hacer click en el espejo.
async function findVisibleOptionEventually(text: string | RegExp, timeoutMs = 8000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const real = screen.queryAllByText(text).filter((el) => el.closest("option") === null);
    if (real.length > 0) return real[real.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No apareció ninguna opción VISIBLE con el texto "${String(text)}" dentro de ${timeoutMs}ms`);
}

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

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter>
          <WarehousesPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

// La lista de bodegas es compartida entre corridas: se recorre como en el
// resto de la suite en vez de asumir que la fila propia está a la vista
// (acá no hay paginación, así que basta con esperar a que termine de cargar).
async function findRow(name: string): Promise<HTMLTableRowElement> {
  const cell = await screen.findByText(name, {}, { timeout: 8000 });
  return cell.closest("tr") as HTMLTableRowElement;
}

// Abre el Select de responsable, elige la opción y espera a que el trigger
// refleje el nuevo valor ANTES de seguir. Sin este último wait, un submit
// disparado en el mismo tick que el click de la opción puede alcanzar a
// Radix antes de que termine de propagar el cambio a RHF (field.onChange) —
// el formulario se manda con el valor VIEJO, sin que ningún error lo avise.
async function pickManagerOption(dialog: HTMLElement, optionText: string | RegExp, expectedTriggerText: string) {
  const trigger = within(dialog).getByRole("combobox", { name: /responsable de bodega/i });
  await waitFor(() => expect(trigger).not.toBeDisabled(), { timeout: 8000 });
  fireEvent.click(trigger);
  fireEvent.click(await findVisibleOptionEventually(optionText));
  await waitFor(() => expect(trigger.textContent).toContain(expectedTriggerText), { timeout: 4000 });
  return trigger;
}

describe("Formulario de Bodegas — responsable, de punta a punta contra el backend real", () => {
  let managerId: string;
  let warehouseId: string | undefined;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
    await signInAs("admin");
    const manager = await apiFetch<{ id: string }>("/users", {
      method: "POST",
      body: JSON.stringify({
        email: `e2e-manager-form-${STAMP}@test.local`,
        password: "Test123!",
        name: MANAGER_NAME,
        role: "OPERATOR",
      }),
    });
    managerId = manager.id;
  }, 30000);

  afterAll(async () => {
    await signInAs("admin");
    if (warehouseId) await apiFetch(`/warehouses/${warehouseId}`, { method: "DELETE" }).catch(() => {});
    await apiFetch(`/users/${managerId}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) }).catch(() => {});
  });

  it("ADMIN: crea una bodega con capacity/phone/notes y un responsable elegido del selector", async () => {
    await signInAs("admin");
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /nueva bodega/i }, { timeout: 8000 }));
    const dialog = await screen.findByRole("dialog");

    fireEvent.change(within(dialog).getByLabelText(/^nombre$/i), { target: { value: WAREHOUSE_NAME } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Continuar sin plano" }));
    fireEvent.change(within(dialog).getByLabelText(/dirección/i), { target: { value: "Av. Siempre Viva 742" } });
    fireEvent.change(within(dialog).getByLabelText(/capacidad/i), { target: { value: "300" } });
    fireEvent.change(within(dialog).getByLabelText(/teléfono/i), { target: { value: "0991112233" } });
    fireEvent.change(within(dialog).getByLabelText(/^notas$/i), { target: { value: "Bodega de prueba del formulario" } });

    await pickManagerOption(dialog, new RegExp(`${MANAGER_NAME} \\(OPERATOR\\)`), MANAGER_NAME);

    fireEvent.click(within(dialog).getByRole("button", { name: /^guardar$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });

    const row = await findRow(WAREHOUSE_NAME);
    expect(row.textContent).toContain("300 posiciones");
    expect(row.textContent).toContain("0991112233");
    expect(row.textContent).toContain(MANAGER_NAME);
    expect(row.textContent).toContain("OPERATOR");
    expect(row.textContent).toContain("Bodega de prueba del formulario");

    // GET /warehouses no pagina (array plano): se confirma también contra la
    // API real, no solo lo que quedó pintado en la tabla.
    const list = await apiFetch<{ id: string; name: string; manager: { id: string } | null }[]>("/warehouses");
    const match = list.find((w) => w.name === WAREHOUSE_NAME);
    expect(match?.manager?.id).toBe(managerId);
    warehouseId = match?.id;
  }, 30000);

  it("editar: cambiar el responsable a 'Sin responsable' lo limpia de verdad (null en la API, no solo visualmente)", async () => {
    await signInAs("admin");
    renderPage();

    const row = await findRow(WAREHOUSE_NAME);
    fireEvent.click(within(row).getByTitle(/editar bodega/i));
    const dialog = await screen.findByRole("dialog");

    // Precargado con el responsable actual — una vez que terminan de cargar
    // las opciones (GET /users real), Radix recién puede resolver el value
    // actual contra su SelectItem correspondiente para mostrar su label.
    await waitFor(
      () => expect(within(dialog).getByRole("combobox", { name: /responsable de bodega/i })).not.toBeDisabled(),
      { timeout: 8000 }
    );
    expect(within(dialog).getByRole("combobox", { name: /responsable de bodega/i }).textContent).toContain(
      MANAGER_NAME
    );

    await pickManagerOption(dialog, /^sin responsable$/i, "Sin responsable");
    fireEvent.click(within(dialog).getByRole("button", { name: /^guardar$/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });

    // findRow encuentra la fila por el NOMBRE, que no cambia con esta edición
    // — resolvería de inmediato aunque el resto de la fila todavía no se haya
    // refrescado (invalidateQueries dispara el refetch, no lo espera). Por
    // eso este chequeo puntual vuelve a consultar el DOM en cada intento, en
    // vez de reusar una referencia de fila capturada una sola vez.
    await waitFor(
      () => {
        const cell = screen.getByText(WAREHOUSE_NAME);
        expect(cell.closest("tr")!.textContent).not.toContain(MANAGER_NAME);
      },
      { timeout: 8000 }
    );

    const stored = await apiFetch<{ manager: { id: string } | null }>(`/warehouses/${warehouseId}`);
    expect(stored.manager).toBeNull();
  }, 30000);

  it("OPERATOR: ve la tabla (incluida la columna Responsable) pero no 'Nueva bodega' ni acciones de editar/eliminar", async () => {
    await signInAs("operator");
    renderPage();

    await findRow(WAREHOUSE_NAME);
    expect(screen.queryByRole("button", { name: /nueva bodega/i })).not.toBeInTheDocument();
    const row = await findRow(WAREHOUSE_NAME);
    expect(within(row).queryByTitle(/editar bodega/i)).not.toBeInTheDocument();
    expect(within(row).queryByTitle(/eliminar bodega/i)).not.toBeInTheDocument();
  }, 30000);

  it("de punta a punta: asignar responsable a una bodega ACTIVA bloquea (409) desactivarlo hasta reasignarlo", async () => {
    await signInAs("admin");
    await apiFetch(`/warehouses/${warehouseId}`, { method: "PATCH", body: JSON.stringify({ managerId }) });

    await expect(
      apiFetch(`/users/${managerId}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) })
    ).rejects.toMatchObject({ status: 409 });
    expect((await apiFetch<{ isActive: boolean }>(`/users/${managerId}`)).isActive).toBe(true);

    await apiFetch(`/warehouses/${warehouseId}`, { method: "PATCH", body: JSON.stringify({ managerId: null }) });
    await expect(
      apiFetch(`/users/${managerId}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) })
    ).resolves.toMatchObject({ isActive: false });

    // Se reactiva para que el afterAll (que también intenta desactivarlo) no
    // dependa de este estado, y para dejar al usuario en un estado conocido.
    await apiFetch(`/users/${managerId}`, { method: "PATCH", body: JSON.stringify({ isActive: true }) });
  }, 30000);
});
