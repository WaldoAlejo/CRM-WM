import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api";
import { WarehouseLayoutEditor } from "./WarehouseLayoutEditor";
import { WarehouseFormDialog } from "./WarehouseFormDialog";
import { newWarehouseLayout, warehouseLayoutSchema } from "./warehouseLayout";
import type { Warehouse } from "./warehouses.types";

const mutations = vi.hoisted(() => ({ create: vi.fn(), update: vi.fn() }));
vi.mock("./useWarehouseMutations", () => ({ useWarehouseMutations: () => ({
  createMutation: { mutateAsync: mutations.create, isPending: false },
  updateMutation: { mutateAsync: mutations.update, isPending: false },
}) }));
vi.mock("./useWarehouseManagerOptions", () => ({ useWarehouseManagerOptions: () => ({ data: [], isLoading: false }) }));

function Editor() {
  const [value, onChange] = useState(newWarehouseLayout);
  return <WarehouseLayoutEditor value={value} onChange={onChange} />;
}
const warehouse: Warehouse = {
  id: "b1", name: "Bodega 1", address: null, capacity: 1, phone: null, notes: null, manager: null,
  isActive: true, createdAt: "2026-09-22", locations: [],
  layout: { ...newWarehouseLayout(), positions: [{ row: 0, column: 0 }] },
};

beforeEach(() => { mutations.create.mockReset().mockResolvedValue({}); mutations.update.mockReset().mockResolvedValue({}); });

describe("Diseñador de ubicaciones", () => {
  it("marca posiciones, genera capacidad por nivel y permite borrarlas", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Posición P-01-01" }));
    fireEvent.click(screen.getByRole("button", { name: "Posición P-01-02" }));
    expect(screen.getByLabelText("Capacidad del plano")).toHaveTextContent("2");
    fireEvent.click(screen.getByLabelText("Esta bodega tiene racks"));
    expect(screen.getByLabelText("Capacidad del plano")).toHaveTextContent("4");
    expect(screen.getByRole("button", { name: "Posición R-01-01-N01" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Posición R-01-01-N01" }));
    expect(screen.getByLabelText("Capacidad del plano")).toHaveTextContent("2");
  });

  it("pinta varias posiciones arrastrando con el mouse sin duplicados", () => {
    render(<Editor />);
    const first = screen.getByRole("button", { name: "Posición P-01-01" });
    const second = screen.getByRole("button", { name: "Posición P-01-02" });
    fireEvent.pointerDown(first, { pointerType: "mouse", button: 0, buttons: 1 });
    fireEvent.pointerEnter(second, { pointerType: "mouse", buttons: 1 });
    fireEvent.pointerEnter(first, { pointerType: "mouse", buttons: 1 });
    expect(screen.getByLabelText("Capacidad del plano")).toHaveTextContent("2");
  });

  it("conserva la selección al reducir el plano y exige confirmar para limpiarla", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Posición P-10-01" }));
    fireEvent.change(screen.getByLabelText("Largo (m)"), { target: { value: "3" } });
    expect(screen.getByRole("alert")).toHaveTextContent("fuera de las nuevas dimensiones");
    expect(screen.getByLabelText("Capacidad del plano")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar selección" }));
    fireEvent.click(screen.getByRole("button", { name: "Conservar selección" }));
    expect(screen.getByLabelText("Capacidad del plano")).toHaveTextContent("1");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar selección" }));
    fireEvent.click(screen.getByRole("button", { name: "Sí, limpiar" }));
    expect(screen.getByLabelText("Capacidad del plano")).toHaveTextContent("0");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("advierte cuando los niveles sobrepasan la altura y cuando la grilla es excesiva", () => {
    render(<Editor />);
    fireEvent.click(screen.getByLabelText("Esta bodega tiene racks"));
    fireEvent.change(screen.getByLabelText("Niveles por rack"), { target: { value: "3" } });
    expect(screen.getByRole("alert")).toHaveTextContent("superan la altura");
    fireEvent.change(screen.getByLabelText("Ancho (m)"), { target: { value: "200" } });
    expect(screen.getByRole("alert")).toHaveTextContent("hasta 20 filas");
    expect(screen.queryByRole("button", { name: "Posición R-01-01-N01" })).not.toBeInTheDocument();
  });

  it("tolera decimales de medidas y rechaza duplicados", () => {
    const layout = { ...newWarehouseLayout(), lengthM: 3.6, cellLengthM: 1.2, positions: [{ row: 2, column: 0 }] };
    expect(warehouseLayoutSchema.safeParse(layout).success).toBe(true);
    expect(warehouseLayoutSchema.safeParse({ ...layout, positions: [...layout.positions, ...layout.positions] }).success).toBe(false);
  });
});

describe("Guardar una bodega con plano", () => {
  it("mantiene el formulario sin plano y su capacidad manual", async () => {
    render(<WarehouseFormDialog open onOpenChange={vi.fn()} warehouse={null} />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Bodega nueva" } });
    fireEvent.change(screen.getByLabelText("Capacidad (posiciones/pallets)"), { target: { value: "17" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mutations.create).toHaveBeenCalledWith(expect.objectContaining({ name: "Bodega nueva", capacity: 17 })));
    expect(mutations.create.mock.calls[0][0]).not.toHaveProperty("layout");
  });

  it("envía dimensiones y posiciones, calcula capacidad y bloquea altura inválida", async () => {
    render(<WarehouseFormDialog open onOpenChange={vi.fn()} warehouse={null} />);
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Bodega nueva" } });
    fireEvent.click(screen.getByRole("button", { name: "Diseñar ubicaciones en un plano" }));
    fireEvent.click(screen.getByRole("button", { name: "Posición P-01-01" }));
    fireEvent.click(screen.getByLabelText("Esta bodega tiene racks"));
    fireEvent.change(screen.getByLabelText("Niveles por rack"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(screen.getAllByText("Los niveles del rack superan la altura de la bodega.").length).toBeGreaterThan(0));
    expect(mutations.create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Altura (m)"), { target: { value: "6" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mutations.create).toHaveBeenCalledWith(expect.objectContaining({ capacity: 3, layout: expect.objectContaining({ rackLevels: 3, heightM: 6, positions: [{ row: 0, column: 0 }] }) })));
  });

  it("reabre el plano guardado y muestra el error de ubicación utilizada sin cerrar", async () => {
    mutations.update.mockRejectedValue(new ApiError("La ubicación tiene movimientos y no puede quitarse.", 409, "layout"));
    const close = vi.fn();
    render(<WarehouseFormDialog open onOpenChange={close} warehouse={warehouse} />);
    expect(screen.getByRole("button", { name: "Posición P-01-01" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Borrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Posición P-01-01" }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    expect(await screen.findByText("La ubicación tiene movimientos y no puede quitarse.")).toBeInTheDocument();
    expect(close).not.toHaveBeenCalled();
  });
});
