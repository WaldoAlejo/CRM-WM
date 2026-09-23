import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SpatialWarehouseEditor } from "./SpatialWarehouseEditor";
import { newSpatialLayout, spatialMetrics, toSpatialLayout, validateSpatialLayout } from "./warehouseSpatialCore";
import type { SpatialLayout } from "./warehouseSpatialCore";
import { newWarehouseLayout } from "./warehouseLayout";

function Editor({ initial = newSpatialLayout() }: { initial?: SpatialLayout }) {
  const [value, onChange] = useState(initial);
  return <><SpatialWarehouseEditor value={value} onChange={onChange} /><output data-testid="state">{JSON.stringify(value)}</output></>;
}
const state = (): SpatialLayout => JSON.parse(screen.getByTestId("state").textContent!);

describe("Plano de espacios", () => {
  it("mantiene un foco fino al seleccionar una pared con teclado sin cambiar su geometría", () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Elemento para agregar"), { target: { value: "WALL" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar al plano" }));
    const original = state();
    fireEvent.click(screen.getByRole("button", { name: "Ver todos" }));
    const wall = screen.getByRole("button", { name: "Seleccionar Pared 1" });
    fireEvent.focus(wall);
    expect(wall).toHaveStyle({ outline: "none" });
    expect(wall.querySelector('[data-focus-ring]')).toHaveAttribute("vector-effect", "non-scaling-stroke");
    fireEvent.keyDown(wall, { key: "Enter" });
    expect(screen.getByRole("heading", { name: "Editar espacio" })).toBeInTheDocument();
    expect(wall).toHaveAttribute("aria-pressed", "true");
    fireEvent.change(screen.getByLabelText("Zoom del plano"), { target: { value: "3" } });
    expect(wall.querySelector('[data-focus-ring]')).toHaveAttribute("stroke-width", "2");
    expect(state()).toEqual(original);
    fireEvent.blur(wall);
    expect(wall.querySelector('[data-focus-ring]')).toBeNull();
  });
  it("agrupa dos pallets en una ubicación y uno en otra", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar al plano" }));
    fireEvent.change(screen.getByLabelText("Nombre"), { target: { value: "Ubicación 1" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar al plano" }));
    fireEvent.click(screen.getByRole("button", { name: "Pallet fila 1 columna 2" }));
    expect(spatialMetrics(state())).toMatchObject({ palletCapacity: 3, locationCount: 2 });
    expect(validateSpatialLayout(state())).toEqual([]);
  });

  it("combina piso y rack alto, valida altura, conserva slots fuera de tamaño", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar al plano" }));
    fireEvent.click(screen.getByRole("button", { name: "Agregar al plano" }));
    fireEvent.change(screen.getByLabelText("Organización"), { target: { value: "RACK" } });
    fireEvent.change(screen.getByLabelText("Niveles"), { target: { value: "10" } });
    expect(screen.getByRole("alert")).toHaveTextContent("altura");
    fireEvent.change(screen.getByLabelText("Altura libre (m)"), { target: { value: "20" } });
    expect(spatialMetrics(state())).toMatchObject({ palletCapacity: 22, locationCount: 21 });
    fireEvent.change(screen.getByLabelText("Ancho (m)"), { target: { value: "1.2" } });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    const rack = state().elements[1];
    expect(rack.type === "STORAGE" && rack.slots).toHaveLength(2);
  });

  it("edita posición, giro y mobiliario y permite deshacer y rehacer borrado", () => {
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Elemento para agregar"), { target: { value: "DESK" } });
    fireEvent.click(screen.getByRole("button", { name: "Agregar al plano" }));
    fireEvent.change(screen.getByLabelText("X (m)"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("Giro (°)"), { target: { value: "90" } });
    expect(state().elements[0]).toMatchObject({ type: "DESK", x: 3, rotation: 90 });
    fireEvent.click(screen.getByRole("button", { name: "Quitar espacio" }));
    expect(state().elements).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(state().elements).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Rehacer" }));
    expect(state().elements).toHaveLength(0);
  });

  it("edita contorno irregular sin eliminar objetos y cancela dibujo", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Contorno en L", hidden: true }));
    expect(state().boundary).toHaveLength(6);
    fireEvent.change(screen.getByLabelText("Vértice 2 X"), { target: { value: "11" } });
    expect(state().boundary[1].x).toBe(11);
    fireEvent.click(screen.getByRole("button", { name: "Dibujar contorno" }));
    expect(screen.getByRole("button", { name: "Cerrar contorno" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar dibujo" }));
    expect(state().boundary).toHaveLength(6);
  });

  it("conserva posiciones y códigos al convertir el plano anterior", () => {
    const legacy = { ...newWarehouseLayout(), positions: [{ row: 0, column: 0 }, { row: 1, column: 2 }] };
    const converted = toSpatialLayout(legacy);
    expect(converted.elements.map(e => e.type === "STORAGE" && e.code)).toEqual(["P-01-01", "P-02-03"]);
    expect(spatialMetrics(converted)).toMatchObject({ palletCapacity: 2, locationCount: 2 });
    expect(validateSpatialLayout(converted)).toEqual([]);
  });

  it("arrastra un objeto y deshace el movimiento completo", () => {
    render(<Editor />);
    fireEvent.click(screen.getByRole("button", { name: "Agregar al plano" }));
    const original = state().elements[0];
    const canvas = screen.getByRole("img", { name: "Plano de la bodega en metros" });
    Object.defineProperty(canvas, "createSVGPoint", { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) });
    Object.defineProperty(canvas, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
    Object.defineProperty(canvas, "setPointerCapture", { value: () => {} });
    fireEvent.pointerDown(screen.getByRole("button", { name: "Seleccionar Ubicación 1" }), { clientX: 1, clientY: 1, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 3, clientY: 2, pointerId: 1 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    expect(state().elements[0]).toMatchObject({ x: original.x + 2, y: original.y + 1 });
    fireEvent.click(screen.getByRole("button", { name: "Deshacer" }));
    expect(state().elements[0]).toEqual(original);
  });

  it("dibuja un perímetro con diagonal mediante sus vértices", () => {
    render(<Editor />);
    const canvas = screen.getByRole("img", { name: "Plano de la bodega en metros" });
    Object.defineProperty(canvas, "createSVGPoint", { value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }) });
    Object.defineProperty(canvas, "getScreenCTM", { value: () => ({ inverse: () => ({}) }) });
    fireEvent.click(screen.getByRole("button", { name: "Dibujar contorno" }));
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 0 });
    fireEvent.pointerDown(canvas, { clientX: 10, clientY: 0 });
    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 8 });
    fireEvent.click(screen.getByRole("button", { name: "Cerrar contorno" }));
    expect(state().boundary).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 8 }]);
    expect(spatialMetrics(state()).totalAreaM2).toBe(40);
    expect(validateSpatialLayout(state())).toEqual([]);
  });
});
