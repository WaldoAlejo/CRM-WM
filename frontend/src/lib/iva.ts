// Espejo de backend/src/lib/ivaRates.ts: código SRI de la tarifa de IVA. Los
// precios de venta son sin IVA; la tarifa del producto se suma en el despacho.
export const IVA_OPTIONS = [
  { code: "4", rate: 15, label: "IVA 15%" },
  { code: "0", rate: 0, label: "IVA 0%" },
  { code: "5", rate: 5, label: "IVA 5%" },
  { code: "10", rate: 13, label: "IVA 13%" },
  { code: "2", rate: 12, label: "IVA 12%" },
  { code: "3", rate: 14, label: "IVA 14%" },
  { code: "8", rate: 8, label: "IVA 8%" },
  { code: "6", rate: 0, label: "No objeto de IVA" },
  { code: "7", rate: 0, label: "Exento de IVA" },
] as const;

export const DEFAULT_IVA_CODE = "4";
