import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProductsPage } from './ProductsPage';
import { VariantsTable } from './components/VariantsTable';
import type { Variant } from './products.types';
const settings = vi.hoisted(() => ({ visible: true }));
vi.mock('@/hooks/usePricingVisibility', () => ({ usePricingVisibility: () => settings.visible }));
vi.mock('./useProducts', () => ({ useProducts: () => ({ page: 1, setPage: vi.fn(), query: { data: { data: [{ id: 'p', sku: 'P', name: 'Producto', category: { name: 'Categoría' }, variantCount: 1, status: 'ACTIVE', weightedAverageCost: '201.00', costPriceUSD: '170' }] }, isLoading: false } }) }));
vi.mock('./useCategoryOptions', () => ({ useCategoryOptions: () => ({ data: [] }) }));
vi.mock('./useVariantMutations', () => ({ useVariantMutations: () => ({ deleteMutation: { mutate: vi.fn(), isPending: false } }) }));
vi.mock('./VariantFormDialog', () => ({ VariantFormDialog: () => null }));
const variant = { id: 'v', sku: 'P-PLOMO', stock: 20, reservedStock: 0, weightedAverageCost: '201.00', costPriceUSD: '170' } as Variant;
beforeEach(() => { settings.visible = true; });
describe('Costo visible en listas de productos y variantes', () => {
  it('muestra el promedio ponderado del producto', () => {
    render(<MemoryRouter><ProductsPage /></MemoryRouter>);
    expect(screen.getByText('$201.00')).toBeInTheDocument();
    expect(screen.getByText('Costo promedio ponderado (USD)')).toBeInTheDocument();
    expect(screen.queryByText('$170')).not.toBeInTheDocument();
  });
  it('muestra el promedio ponderado de cada variante sin recurrir al costo de fábrica', () => {
    render(<VariantsTable productId="p" productStatus="ACTIVE" variants={[variant, { ...variant, id: 'empty', sku: 'SIN-INGRESOS', weightedAverageCost: null }]} />);
    expect(screen.getAllByText('$201.00')).toHaveLength(1);
    expect(screen.queryByText('$170')).not.toBeInTheDocument();
  });
  it('oculta las columnas de costo al operador', () => {
    settings.visible = false;
    render(<MemoryRouter><ProductsPage /><VariantsTable productId="p" productStatus="ACTIVE" variants={[variant]} /></MemoryRouter>);
    expect(screen.queryByText('Costo promedio ponderado (USD)')).not.toBeInTheDocument();
    expect(screen.queryByText('$201.00')).not.toBeInTheDocument();
  });
});
