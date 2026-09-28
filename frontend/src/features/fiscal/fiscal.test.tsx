import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import { MailSettingsPage } from "./MailSettingsPage";
import { FiscalSettingsPage } from "./FiscalSettingsPage";
import { FiscalDocumentsPage } from "./FiscalDocumentsPage";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));
const settings = { settings: { activeIssuerId: null, defaultMailProfileId: "mail" }, encryptionReady: true, productionEnabled: false, issuers: [], mailProfiles: [{ id: "mail", name: "Facturación", fromName: "Empresa", fromEmail: "facturas@example.invalid", host: "smtp.example.invalid", port: 587, security: "STARTTLS", username: "user", hasPassword: true, enabled: true }] };
beforeEach(() => { vi.mocked(apiFetch).mockReset(); vi.mocked(apiFetch).mockImplementation(async path => path === "/settings" ? settings : path.startsWith("/fiscal-documents?") ? { data: [], total: 0 } : []); });
function show(node: React.ReactNode) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); return render(<QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>); }
describe("configuración fiscal", () => {
  it("no rellena ni revela la contraseña SMTP y distingue verificar de enviar", async () => {
    show(<MailSettingsPage />); fireEvent.click(await screen.findByRole("button", { name: "Editar y probar" }));
    expect(screen.getByLabelText("Nueva contraseña (vacío conserva la actual)")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Enviar prueba" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Verificar conexión guardada" }));
    await waitFor(() => expect(vi.mocked(apiFetch)).toHaveBeenCalledWith("/settings/mail/mail/verify", expect.objectContaining({ method: "POST" })));
  });
  it("mantiene producción desactivada y permite agregar otro emisor", async () => {
    show(<FiscalSettingsPage />);
    expect(await screen.findByText(/La emisión de producción está desactivada/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nueva empresa" }));
    expect(screen.getByRole("option", { name: "Producción" })).toBeDisabled();
    expect(screen.getByLabelText("RUC")).toHaveValue("");
  });
  it("distingue tipos de documento y anulaciones del estado autorizado", async () => {
    show(<FiscalDocumentsPage />);
    expect(await screen.findByText(/No hay comprobantes con estos filtros/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Nota de crédito" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Anulado" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Autorizado" })).toBeInTheDocument();
  });
});
