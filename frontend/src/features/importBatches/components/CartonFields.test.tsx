import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useForm, useFieldArray, useWatch } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { ReceiveLinesTable } from './ReceiveLinesTable';
import { receiveFormSchema, type ReceiveFormValues } from '../importBatches.schema';
vi.mock('@/features/locations/WarehouseLocationSelect', () => ({ WarehouseLocationSelect: () => <span>Bodega seleccionada</span> }));
function FormExample() {
  const form = useForm<ReceiveFormValues>({ defaultValues: { lines: [{ variantId: 'v', sku: 'PRODUCTO-1', productName: 'Producto', label: null, quantity: 1, unitCost: 10, volumeCbm: 3.79, locationId: 'l' }] } });
  const fields = useFieldArray({ control: form.control, name: 'lines' });
  const lines = useWatch({ control: form.control, name: 'lines' });
  return <Form {...form}><ReceiveLinesTable control={form.control} errors={form.formState.errors} fields={fields.fields} remove={fields.remove} costPerCbm={null} /><output data-testid="values">{JSON.stringify(lines)}</output></Form>;
}
describe('Recepción por cartones', () => {
  it('calcula 210 unidades, 12 pilas y conserva 3.79 CBM sin pedir dimensiones', () => {
    render(<FormExample />);
    fireEvent.click(screen.getByLabelText('Registrar cartones · PRODUCTO-1'));
    fireEvent.change(screen.getByLabelText('Cartones PRODUCTO-1'), { target: { value: '35' } });
    fireEvent.change(screen.getByLabelText('Unidades por cartón PRODUCTO-1'), { target: { value: '6' } });
    expect(screen.getByLabelText('Cantidad PRODUCTO-1')).toHaveValue(210);
    expect(screen.getByLabelText('Cantidad PRODUCTO-1')).toHaveAttribute('readonly');
    expect(screen.getByText('12 pilas de hasta 3 cartones')).toBeInTheDocument();
    expect(screen.getByText(/Superficie mínima estimada: Pendiente/)).toBeInTheDocument();
    const lines = JSON.parse(screen.getByTestId('values').textContent!);
    expect(receiveFormSchema.safeParse({ lines }).success).toBe(true);
    expect(lines[0]).toMatchObject({ quantity: 210, volumeCbm: 3.79, packaging: { cartonCount: 35, unitsPerCarton: 6, maxStackCartons: 3, stackingConfirmed: false } });
  });
  it('permite volver a ingreso por unidades y elimina los datos opcionales del cartón', () => {
    render(<FormExample />);
    fireEvent.click(screen.getByLabelText('Registrar cartones · PRODUCTO-1'));
    fireEvent.click(screen.getByLabelText('Registrar cartones · PRODUCTO-1'));
    expect(screen.getByLabelText('Cantidad PRODUCTO-1')).not.toHaveAttribute('readonly');
    expect(JSON.parse(screen.getByTestId('values').textContent!)[0]).not.toHaveProperty('packaging');
  });
});
