/** Redondeos posibles al aumentar precios (en centavos): $1, $10, $50, $100, $500, $1.000. */
export const PRICE_ROUNDINGS = [100, 1_000, 5_000, 10_000, 50_000, 100_000] as const;
export type PriceRounding = (typeof PRICE_ROUNDINGS)[number];

/**
 * Aplica un aumento (o baja) porcentual a un precio y lo redondea al múltiplo elegido.
 * percentBps: 1000 = +10 %, -500 = −5 %. Todo en enteros de centavos.
 * Ej.: $15.000 +12 % redondeado a $100 → $16.800.
 */
export function applyPercentChange(cents: number, percentBps: number, roundToCents: number): number {
  const raw = (cents * (10_000 + percentBps)) / 10_000;
  const rounded = Math.round(raw / roundToCents) * roundToCents;
  return Math.max(0, rounded);
}
