// E2E contra el backend real: alta -> aparece en la tabla -> editar (nombre
// y rol) -> resetear contraseña (la temporal revelada sirve para loguear) ->
// desactivar -> activar. Además: la página es ADMIN-only (mismo patrón
// RequireRole que /accounts-receivable), y la propia fila del admin logueado
// nunca ofrece activar/desactivarse ni cambiar su propio rol.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RequireRole } from "@/components/auth/RequireRole";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { UsersPage } from "./UsersPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const OPERATOR_CREDENTIALS = { email: "operador@kestore.com.ec", password: "Operador123!" };
const USER_STORAGE_KEY = "wm_kestore_user";

const NAME = `E2E Usuario ${Date.now()}`;
const NAME_EDITADO = `${NAME} (editado)`;
const EMAIL = `e2e-user-${Date.now()}@kestore.com.ec`;

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

function renderWithGate(initialPath: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<RequireRole roles={["ADMIN"]} />}>
              <Route path="/admin/users" element={<UsersPage />} />
            </Route>
            <Route path="/" element={<div>Dashboard placeholder</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Usuarios — ADMIN-only, CRUD y protecciones, contra el backend real", () => {
  let createdUserId: string | undefined;

  beforeAll(async () => {
    const health = await fetch(`${BASE}/health`).catch(() => null);
    if (!health || !health.ok) {
      throw new Error(`Este test necesita el backend real corriendo en ${BASE} (cd backend && npm run dev).`);
    }
  });

  afterAll(async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);
    // No hay DELETE (por diseño, ver users.service.ts) — la limpieza posible
    // es desactivarlo, igual que haría un admin real con una cuenta de prueba.
    if (createdUserId) {
      await apiFetch(`/users/${createdUserId}`, { method: "PATCH", body: JSON.stringify({ isActive: false }) }).catch(
        () => {}
      );
    }
  });

  it("OPERATOR no puede acceder — redirige, misma protección RequireRole que el router real", async () => {
    const operator = await loginAs("operator");
    setSession(operator.token, operator.user);

    renderWithGate("/admin/users");

    await screen.findByText("Dashboard placeholder");
    expect(screen.queryByText(/^usuarios$/i)).not.toBeInTheDocument();
  }, 15000);

  it("crear -> editar -> resetear contraseña -> desactivar -> activar, todo desde la UI real", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    renderWithGate("/admin/users");
    await screen.findByRole("heading", { name: /^usuarios$/i });

    // --- Crear ---
    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }));
    fireEvent.change(await screen.findByLabelText(/^nombre$/i), { target: { value: NAME } });
    fireEvent.change(screen.getByLabelText(/^email$/i), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText(/contraseña inicial/i), { target: { value: "Clave12345" } });
    fireEvent.click(screen.getByRole("button", { name: /crear usuario/i }));

    const nameCell = await findLastByTextEventually(NAME, 8000);
    let row = nameCell.closest("tr");
    if (!row) throw new Error("No se encontró la fila del usuario recién creado");
    expect(within(row).getByText("OPERATOR")).toBeInTheDocument();
    expect(within(row).getByText("Activo")).toBeInTheDocument();

    const usersList = await apiFetch<{ id: string; email: string }[]>("/users");
    const created = usersList.find((u) => u.email === EMAIL);
    expect(created).toBeTruthy();
    createdUserId = created!.id;

    // --- Editar: nombre y rol ---
    fireEvent.click(within(row).getByTitle(/editar usuario/i));
    const editNameInput = await screen.findByDisplayValue(NAME);
    fireEvent.change(editNameInput, { target: { value: NAME_EDITADO } });
    fireEvent.click(screen.getByRole("combobox", { name: /^rol$/i }));
    fireEvent.click(await findLastByTextEventually("Administrador"));
    fireEvent.click(screen.getByRole("button", { name: /^guardar$/i }));

    const editedCell = await findLastByTextEventually(NAME_EDITADO, 8000);
    row = editedCell.closest("tr");
    if (!row) throw new Error("No se encontró la fila tras editar");
    expect(within(row).getByText("ADMIN")).toBeInTheDocument();

    // --- Resetear contraseña ---
    fireEvent.click(within(row).getByTitle(/resetear contraseña/i));
    fireEvent.click(await screen.findByRole("button", { name: /^resetear contraseña$/i }));
    const passwordInput = (await screen.findByDisplayValue(/.+/, {}, { timeout: 8000 })) as HTMLInputElement;
    const temporaryPassword = passwordInput.value;
    expect(temporaryPassword.length).toBeGreaterThanOrEqual(8);
    fireEvent.click(screen.getByRole("button", { name: /^listo$/i }));

    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: EMAIL, password: temporaryPassword }),
    });
    expect(loginRes.status).toBe(200);

    // --- Desactivar ---
    fireEvent.click(within(row).getByTitle(/desactivar usuario/i));
    fireEvent.click(await screen.findByRole("button", { name: /^desactivar$/i }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    row = (await findLastByTextEventually(NAME_EDITADO, 8000)).closest("tr");
    if (!row) throw new Error("No se encontró la fila tras desactivar");
    await within(row).findByText("Inactivo", {}, { timeout: 8000 });

    // --- Activar (sin confirmación) ---
    fireEvent.click(within(row).getByTitle(/activar usuario/i));
    await within(row).findByText("Activo", {}, { timeout: 8000 });
  }, 30000);

  it("la propia fila del admin logueado no ofrece activar/desactivar, y el rol aparece deshabilitado al editar", async () => {
    const admin = await loginAs("admin");
    setSession(admin.token, admin.user);

    renderWithGate("/admin/users");
    await screen.findByRole("heading", { name: /^usuarios$/i });

    const selfCell = await findLastByTextEventually(admin.user.name, 8000);
    const selfRow = selfCell.closest("tr");
    if (!selfRow) throw new Error("No se encontró la fila del propio admin");

    expect(within(selfRow).queryByTitle(/desactivar usuario/i)).not.toBeInTheDocument();
    expect(within(selfRow).queryByTitle(/activar usuario/i)).not.toBeInTheDocument();

    fireEvent.click(within(selfRow).getByTitle(/editar usuario/i));
    const roleCombobox = await screen.findByRole("combobox", { name: /^rol$/i });
    expect(roleCombobox).toBeDisabled();
    expect(screen.getByText(/no podés cambiar tu propio rol/i)).toBeInTheDocument();
  }, 15000);
});
