// Integer cents and hundredths of a percent avoid floating-point half-cent errors.
export function negotiatedPrice(cost: number, markupPct: number): number {
  if (!Number.isFinite(cost) || !Number.isFinite(markupPct) || cost < 0 || markupPct < 0) return 0;
  const cents = BigInt(Math.round(cost * 100));
  const factor = BigInt(10000 + Math.round(markupPct * 100));
  return Number((cents * factor + 5000n) / 10000n) / 100;
}
