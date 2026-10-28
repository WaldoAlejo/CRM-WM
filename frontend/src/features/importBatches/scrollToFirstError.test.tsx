import { zodResolver } from '@hookform/resolvers/zod';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Resolver } from 'react-hook-form';
import { useFieldArray, useForm } from 'react-hook-form';
import { Form } from '@/components/ui/form';
import { ReceiveLinesTable } from './components/ReceiveLinesTable';
import { receiveFormSchema, type ReceiveFormValues } from './importBatches.schema';
import { useScrollToFirstError } from './scrollToFirstError';
vi.mock('@/features/locations/WarehouseLocationSelect', () => ({ WarehouseLocationSelect: () => <span>Sin bodega</span> }));
function FormExample() {
  const form = useForm<ReceiveFormValues>({ resolver: zodResolver(receiveFormSchema) as Resolver<ReceiveFormValues>, shouldFocusError: false,
    defaultValues: { lines: [{ variantId: 'v', sku: 'PER-0001', productName: 'Perfume', label: null, quantity: 1, unitCost: 22.91, volumeCbm: 0.00098, locationId: '' }] } });
  const fields = useFieldArray({ control: form.control, name: 'lines' });
  const formRef = useScrollToFirstError(form.formState);
  return <Form {...form}><form ref={formRef} onSubmit={form.handleSubmit(() => {})}>
    <ReceiveLinesTable control={form.control} errors={form.formState.errors} fields={fields.fields} remove={fields.remove} costPerCbm={null} />
    <button type="submit">Guardar</button>
  </form></Form>;
}
describe('scrollToFirstError', () => {
  it('lleva a la vista el error de bodega aunque esté al final de la fila', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<FormExample />);
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    const message = await screen.findByText('Selecciona la bodega y ubicación de destino');
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    expect(scrollIntoView.mock.contexts[0]).toBe(message);
    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ inline: 'center', block: 'center' }));
  });
});
