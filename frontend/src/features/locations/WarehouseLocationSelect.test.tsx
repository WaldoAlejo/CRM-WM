import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { WarehouseLocationSelect } from "./WarehouseLocationSelect";

const state = vi.hoisted(() => ({ isLoading: false, isError: false, refetch: vi.fn() }));
vi.mock("@/features/warehouses/useWarehouseOptions", () => ({ useWarehouseOptions: () => ({ ...state, data: [
  { id: "a", name: "Bodega A", isActive: true, locations: [{ id: "a1", code: "A1", isActive: true, type: "STANDARD" }, { id: "q", code: "Cuarentena", isActive: true, type: "CUARENTENA" }] },
  { id: "b", name: "Bodega B", isActive: true, locations: [{ id: "b1", code: "B1", isActive: true, type: "STANDARD" }, { id: "old", code: "Inactiva", isActive: false }] },
  { id: "empty", name: "Bodega vacía", isActive: true, locations: [] },
  { id: "inactive", name: "Bodega inactiva", isActive: false, locations: [] },
] }) }));
function Harness({ initial }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return <><WarehouseLocationSelect value={value} onChange={setValue} label="SKU" /><output data-testid="saved">{value ?? "vacío"}</output></>;
}
async function select(label: string, option: string) {
  fireEvent.click(screen.getByRole("combobox", { name: label }));
  fireEvent.click(await screen.findByRole("option", { name: option }));
}
beforeEach(() => { state.isLoading = false; state.isError = false; vi.clearAllMocks(); });
it("filtra ubicaciones por bodega y limpia la anterior al cambiar de bodega", async () => {
  render(<Harness />);
  expect(screen.getByRole("combobox", { name: "Ubicación SKU" })).toBeDisabled();
  await select("Bodega SKU", "Bodega A");
  fireEvent.click(screen.getByRole("combobox", { name: "Ubicación SKU" }));
  expect(screen.queryByRole("option", { name: /B1|Cuarentena/ })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("option", { name: "Bodega A · A1" }));
  expect(screen.getByTestId("saved")).toHaveTextContent("a1");
  await select("Bodega SKU", "Bodega B");
  expect(screen.getByTestId("saved")).toHaveTextContent("vacío");
  await select("Ubicación SKU", "Bodega B · B1");
  expect(screen.getByTestId("saved")).toHaveTextContent("b1");
});
it("recupera la bodega de una ubicación ya guardada", () => {
  render(<Harness initial="b1" />);
  expect(screen.getByRole("combobox", { name: "Bodega SKU" })).toHaveTextContent("Bodega B");
  expect(screen.getByRole("combobox", { name: "Ubicación SKU" })).toHaveTextContent("B1");
});
it("explica las bodegas sin ubicaciones y permite abrir su configuración sin perder el formulario", async () => {
  render(<Harness />);
  await select("Bodega SKU", "Bodega vacía");
  expect(screen.getByText(/no tiene ubicaciones operativas/)).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Ubicación SKU" })).toBeDisabled();
  expect(screen.getByRole("link")).toHaveAttribute("href", "/catalog/warehouses/empty/locations");
  expect(screen.getByRole("link")).toHaveAttribute("target", "_blank");
});
it("muestra errores de carga y permite reintentar", () => {
  state.isError = true;
  render(<Harness />);
  expect(screen.getByRole("alert")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));
  expect(state.refetch).toHaveBeenCalledOnce();
});
