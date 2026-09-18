// E2E contra el backend real: reglas del rol CEO en la página de Usuarios.
// ADMIN no puede asignar el rol CEO ni tocar filas CEO (el backend responde
// 403); CEO sí ve la opción "CEO" y las acciones sobre otros CEO.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { fetch as undiciFetch } from "undici";
import { describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import type { AuthUser } from "@/types/auth";
import { UsersPage } from "./UsersPage";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const CREDENTIALS = {
  ceo: { email: "ceo@kestore.com.ec", password: "Ceo123456!" },
  admin: { email: "admin@kestore.com.ec", password: "Admin123!" },
} as const;
const USER_STORAGE_KEY = "wm_kestore_user";

async function signInAs(role: keyof typeof CREDENTIALS) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(CREDENTIALS[role]),
  });
  const session = (await res.json()) as { token: string; user: AuthUser };
  setToken(session.token);
  localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(session.user));
  return session;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter>
          <UsersPage />
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}

async function findLastByText(text: string, timeoutMs = 8000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const matches = screen.queryAllByText(text);
    if (matches.length > 0) return matches[matches.length - 1];
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`No apareció "${text}" dentro de ${timeoutMs}ms`);
}

describe("Usuarios y el rol CEO — contra el backend real", () => {
  it("ADMIN: la fila del CEO no ofrece acciones, y el selector de rol al crear NO trae la opción CEO", async () => {
    await signInAs("admin");
    renderPage();

    const ceoRowCell = await findLastByText("CEO WM");
    const ceoRow = ceoRowCell.closest("tr")!;
    expect(within(ceoRow).getByText("Solo un CEO")).toBeInTheDocument();
    expect(within(ceoRow).queryByTitle(/editar usuario/i)).not.toBeInTheDocument();
    expect(within(ceoRow).queryByTitle(/resetear contraseña/i)).not.toBeInTheDocument();
    expect(within(ceoRow).queryByTitle(/desactivar usuario/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }));
    fireEvent.click(await screen.findByRole("combobox", { name: /^rol$/i }));
    await findLastByText("Administrador");
    expect(screen.queryByText("CEO", { selector: "[role=option] *, [role=option]" })).not.toBeInTheDocument();
  }, 30000);

  it("CEO: la fila del CEO SÍ ofrece acciones, y el selector de rol al crear trae la opción CEO", async () => {
    await signInAs("ceo");
    renderPage();

    const rows = await screen.findAllByText("CEO WM", {}, { timeout: 8000 });
    const ceoRow = rows[rows.length - 1].closest("tr")!;
    // Es la propia fila del CEO logueado: puede editarse (nombre/email), no activar/desactivarse.
    expect(within(ceoRow).getByTitle(/editar usuario/i)).toBeInTheDocument();
    expect(within(ceoRow).queryByText("Solo un CEO")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /nuevo usuario/i }));
    fireEvent.click(await screen.findByRole("combobox", { name: /^rol$/i }));
    await findLastByText("Administrador");
    expect(await findLastByText("CEO")).toBeInTheDocument();
  }, 30000);

  it("el backend rechaza igual (403) que un ADMIN cree un CEO por API directa", async () => {
    await signInAs("admin");
    await expect(
      apiFetch("/users", {
        method: "POST",
        body: JSON.stringify({ email: `e2e-ceo-${Date.now()}@kestore.com.ec`, password: "Clave12345", name: "X", role: "CEO" }),
      })
    ).rejects.toMatchObject({ status: 403 });
  }, 15000);
});
