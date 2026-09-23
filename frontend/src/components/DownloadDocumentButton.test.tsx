import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DownloadDocumentButton } from "./DownloadDocumentButton";
import { apiFetchBlob } from "@/lib/api";
import { toast } from "sonner";

vi.mock("@/lib/api", () => ({ apiFetchBlob: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe("Descarga de documentos", () => {
  it("descarga un PDF autenticado y evita solicitudes duplicadas", async () => {
    let finish!: (blob: Blob) => void;
    vi.mocked(apiFetchBlob).mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:document");
    render(<DownloadDocumentButton path="/dispatch-orders/123" filename="despacho-123">PDF despacho</DownloadDocumentButton>);
    fireEvent.click(screen.getByRole("button")); fireEvent.click(screen.getByRole("button"));
    expect(apiFetchBlob).toHaveBeenCalledTimes(1);
    expect(apiFetchBlob).toHaveBeenCalledWith("/documents/dispatch-orders/123");
    expect(screen.getByRole("button")).toBeDisabled();
    finish(new Blob(["%PDF-test"], { type: "application/pdf" }));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(screen.getByRole("button")).toBeEnabled();
  });
  it("muestra un error del proceso sin descargar un falso PDF y permite reintentar", async () => {
    vi.mocked(apiFetchBlob).mockRejectedValue(new Error("No hay movimientos de bodega registrados"));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(<DownloadDocumentButton path="/returns/123/warehouse-in" filename="ingreso">PDF ingreso</DownloadDocumentButton>);
    fireEvent.click(screen.getByRole("button"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("No hay movimientos de bodega registrados"));
    expect(click).not.toHaveBeenCalled();
    expect(screen.getByRole("button")).toBeEnabled();
  });
});
