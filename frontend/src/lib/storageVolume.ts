/** Dimensions describe one packaged inventory unit, upright, in centimetres. */
export function parseDimensions(value: string | null | undefined): [number, number, number] | null {
  if (!value) return null;
  const parts = value.trim().split(/\s*[x×]\s*/i).map(part => Number(part.replace(',', '.')));
  return parts.length === 3 && parts.every(n => Number.isFinite(n) && n > 0 && n <= 100000)
    ? parts as [number, number, number] : null;
}

export function storageEstimate(dimensionsCm: string | null | undefined, quantity: number, maxStackUnits: number, heightM?: number) {
  const dimensions = parseDimensions(dimensionsCm);
  if (!dimensions || quantity < 0 || !Number.isInteger(maxStackUnits) || maxStackUnits < 1) return null;
  const [length, width, height] = dimensions.map(n => n / 100);
  const layers = heightM === undefined ? maxStackUnits : Math.min(maxStackUnits, Math.floor((heightM + 1e-9) / height));
  const unitCbm = length * width * height;
  return { unitCbm, totalCbm: unitCbm * quantity, layers,
    stackHeightM: Math.min(quantity, layers) * height,
    floorAreaM2: layers > 0 ? Math.ceil(quantity / layers) * length * width : null };
}
