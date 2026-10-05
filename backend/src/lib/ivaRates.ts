// Códigos de porcentaje de IVA de la ficha técnica del SRI y su tarifa. Los
// precios de venta son SIN IVA: la tarifa del producto se congela en cada línea
// del despacho (DispatchOrderItem.ivaRate) y computeOrderTotal la suma al total.
export const IVA_RATES = { "0": 0, "2": 12, "3": 14, "4": 15, "5": 5, "6": 0, "7": 0, "8": 8, "10": 13 } as const;
export type IvaCode = keyof typeof IVA_RATES;
export const IVA_CODES = Object.keys(IVA_RATES) as [IvaCode, ...IvaCode[]];
// Tarifa general vigente: la que recibe un producto nuevo si no se elige otra.
export const DEFAULT_IVA_CODE: IvaCode = "4";
