// E2E contra el backend real, renderizando la página COMPLETA (no solo el
// hook): crea un mayorista con el formulario a medida (botón "Validar RUC"),
// confirma que AHORA SÍ aparecen ✏️/🗑️ (el backend ya expone PATCH/DELETE),
// edita con el dialog genérico (CrudFormDialog) y elimina con el genérico
// (ConfirmDeleteDialog) — limpiando el registro de prueba al final con el
// DELETE real, no dejando basura permanente como antes.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { fetch as undiciFetch } from "undici";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AuthProvider } from "@/context/AuthContext";
import { apiFetch, setToken } from "@/lib/api";
import { WholesalersPage } from "./WholesalersPage";

// AuthContext.tsx guarda el usuario logueado bajo esta key privada (no
// exportada) para poder rehidratar la sesión al recargar — WholesalersPage
// ahora llama a useAuth() (para ✏️/🗑️ admin-only), así que el test necesita
// sembrarla igual que lo haría un login real, no solo el token.
const USER_STORAGE_KEY = "wm_kestore_user";

globalThis.fetch = undiciFetch as unknown as typeof fetch;

const BASE = "http://localhost:4000";
const ADMIN_CREDENTIALS = { email: "admin@kestore.com.ec", password: "Admin123!" };
const BUSINESS_NAME = `E2E Mayorista ${Date.now()}`;
const BUSINESS_NAME_EDITADO = `${BUSINESS_NAME} (editado)`;
// Date.now() ya son 13 dígitos (hasta el año 2286): sirve tal cual como RUC
// con formato válido, y es único por corrida.
const RUC = String(Date.now());

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider>
        <WholesalersPage />
      </AuthProvider>
    </QueryClientProvider>
  );
}

describe("Wholesalers — crear (con Validar RUC) + editar/eliminar ahora que el backend los expone", () => {
  let createdId: string | undefined;

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
        `No se pudo autenticar con las credenciales de seed (${ADMIN_CREDENTIALS.email}). ` +
          '¿Corriste "npx prisma db seed" en backend/?'
      );
    }
    const { token, user } = (await loginRes.json()) as { token: string; user: unknown };
    setToken(token);
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user));
  });

  afterAll(async () => {
    // Fallback además del delete que hace el propio test: si algo falla
    // ANTES de llegar al paso de eliminar, esto igual deja la base limpia
    // (real ahora que el DELETE existe — antes esto era un 404 garantizado).
    const list = await apiFetch<{ id: string; ruc: string }[]>("/wholesalers").catch(() => []);
    const idToDelete = createdId ?? list.find((w) => w.ruc === RUC)?.id;
    if (idToDelete) await apiFetch(`/wholesalers/${idToDelete}`, { method: "DELETE" }).catch(() => {});
  });

  it("crear (con Validar RUC) -> ✏️ editar -> 🗑️ eliminar, todo desde la página real", async () => {
    renderPage();

    // --- Crear ---
    await screen.findByRole("button", { name: /nuevo mayorista/i });
    fireEvent.click(screen.getByRole("button", { name: /nuevo mayorista/i }));

    const rucInput = await screen.findByPlaceholderText("1234567890001");
    fireEvent.change(rucInput, { target: { value: RUC } });

    // RUC_VALIDATION_API_URL no está configurada en este entorno de dev
    // (confirmado en backend/.env) — el backend real responde found:false.
    fireEvent.click(screen.getByRole("button", { name: /validar ruc/i }));
    await screen.findByText(/no se encontró información para este ruc/i, {}, { timeout: 8000 });

    fireEvent.change(screen.getByPlaceholderText("Ej: Comercial Andina S.A."), {
      target: { value: BUSINESS_NAME },
    });
    fireEvent.click(screen.getByRole("button", { name: /^guardar$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });
    await screen.findByText(BUSINESS_NAME, {}, { timeout: 8000 });

    const list = await apiFetch<{ id: string; businessName: string }[]>("/wholesalers");
    createdId = list.find((w) => w.businessName === BUSINESS_NAME)?.id;
    expect(createdId).toBeTruthy();

    // El punto central pedido: ahora SÍ aparecen los íconos (antes de este
    // cambio, esto habría fallado — el backend no tenía PATCH/DELETE). Hay
    // que escoparlo a la FILA de esta prueba: el mayorista ya seedeado
    // ("Distribuidora Demo S.A.") también tiene sus propios ✏️/🗑️ ahora.
    const row = screen.getByText(BUSINESS_NAME).closest("tr");
    if (!row) throw new Error("No se encontró la fila del mayorista recién creado");
    expect(within(row).getByTitle("Editar mayorista")).toBeInTheDocument();
    expect(within(row).getByTitle("Eliminar mayorista")).toBeInTheDocument();

    // --- Editar (CrudFormDialog genérico) ---
    fireEvent.click(within(row).getByTitle("Editar mayorista"));
    const editBusinessNameInput = await screen.findByDisplayValue(BUSINESS_NAME);
    fireEvent.change(editBusinessNameInput, { target: { value: BUSINESS_NAME_EDITADO } });
    fireEvent.click(screen.getByRole("button", { name: /^guardar$/i }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument(), { timeout: 8000 });
    const editedRow = (await screen.findByText(BUSINESS_NAME_EDITADO, {}, { timeout: 8000 })).closest("tr");
    if (!editedRow) throw new Error("No se encontró la fila del mayorista editado");

    // --- Eliminar (ConfirmDeleteDialog genérico) ---
    fireEvent.click(within(editedRow).getByTitle("Eliminar mayorista"));
    await screen.findByRole("alertdialog");
    fireEvent.click(screen.getByRole("button", { name: /^eliminar$/i }));

    await waitFor(() => expect(screen.queryByText(BUSINESS_NAME_EDITADO)).not.toBeInTheDocument(), {
      timeout: 8000,
    });

    // Ya se borró de verdad: nada que limpiar en afterAll para este id.
    createdId = undefined;
  }, 30000);
});
