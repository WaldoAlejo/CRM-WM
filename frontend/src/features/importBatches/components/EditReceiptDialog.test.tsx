import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EditReceiptDialog } from './EditReceiptDialog';
import type { ImportBatchMovement } from '../importBatches.types';
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiFetch: mocks.api }));
vi.mock('@/features/locations/useLocationOptions', () => ({ useLocationOptions: () => ({ options: [{ id: 'l', label: 'Bodega · A1' }], isLoading: false }) }));
vi.mock('@/features/warehouses/useWarehouseOptions', () => ({ useWarehouseOptions: () => ({ data: [] }) }));
const movement: ImportBatchMovement = { id: 'm', variantId: 'v', quantity: 20, volumeCbm: '2', notes: null, createdAt: '2026-09-22', toLocationId: null, variant: { sku: 'WM-001-PLOMO', label: 'Plomo', productId: 'p', dimensionsCm: null, maxStackUnits: 1 } };
function show() {
  const close = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { mutations: { retry: false } } })}><EditReceiptDialog batchId="b" movement={movement} onClose={close} /></QueryClientProvider>);
  return close;
}
beforeEach(() => { mocks.api.mockReset().mockResolvedValue({}); });
describe('Editar un ingreso sin ubicación', () => {
  it('añade empaque al ingreso existente y conserva las unidades y dimensiones del producto', async () => {
    const close = show();
    fireEvent.click(screen.getByLabelText('Registrar cartones'));
    fireEvent.change(screen.getByLabelText('Cartones'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Unidades por cartón'), { target: { value: '4' } });
    expect(screen.queryByLabelText('Dimensiones del empaque por unidad (cm)')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(JSON.parse(mocks.api.mock.calls[0][1].body)).toEqual({ locationId: null, packaging: { cartonCount: 5, unitsPerCarton: 4, maxStackCartons: 3, stackingConfirmed: false } });
  });
  it('muestra CBM y apilamiento, guarda datos físicos sin cambiar CBM facturados', async () => {
    const close = show();
    fireEvent.change(screen.getByLabelText('Ubicación del ingreso'), { target: { value: 'l' } });
    fireEvent.change(screen.getByLabelText('Dimensiones del empaque por unidad (cm)'), { target: { value: '50x40x30' } });
    fireEvent.change(screen.getByLabelText('Máximo de unidades por pila (incluye la base)'), { target: { value: '3' } });
    expect(screen.getByText('Volumen de 20 unidades: 1.200000 m³')).toBeInTheDocument();
    expect(screen.getByText('Superficie mínima estimada: 1.400 m²')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(mocks.api).toHaveBeenCalledWith('/import-batches/b/movements/m', { method: 'PATCH', body: JSON.stringify({ locationId: 'l', dimensionsCm: '50x40x30', maxStackUnits: 3 }) });
  });
  it('mantiene el diálogo abierto ante conflictos y bloquea dimensiones inválidas', async () => {
    const close = show();
    fireEvent.change(screen.getByLabelText('Dimensiones del empaque por unidad (cm)'), { target: { value: '50x0x30' } });
    expect(screen.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Dimensiones del empaque por unidad (cm)'), { target: { value: '50x40x30' } });
    mocks.api.mockRejectedValue(new Error('Hay unidades reservadas'));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar cambios' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Hay unidades reservadas');
    expect(close).not.toHaveBeenCalled();
  });
});
