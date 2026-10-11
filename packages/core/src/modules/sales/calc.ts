/**
 * Cálculos puros de ventas, comisiones y caja (sin base, testeados aparte).
 * Todo en centavos BigInt: nunca decimales.
 */

export type ItemType = 'SERVICE' | 'PRODUCT' | 'TIP';

export interface RateInput {
  itemType: ItemType;
  barber: { serviceCommissionBps: number; productCommissionBps: number; tipCommissionBps: number };
  /** Override barbero + servicio (prioridad máxima). */
  barberServiceBps?: number | null;
  /** Override del servicio para todos los barberos. */
  serviceBps?: number | null;
  /** Override del producto. */
  productBps?: number | null;
}

/**
 * Tasa aplicable (docs/fase-0/01-arquitectura.md §12):
 * - Servicios: barbero+servicio → servicio → % de servicios del barbero.
 * - Productos: producto → % de productos del barbero.
 * - Propinas: % de propinas del barbero (0 por defecto: quedan para la casa, P22).
 */
export function commissionRateBps(input: RateInput): number {
  switch (input.itemType) {
    case 'SERVICE':
      return input.barberServiceBps ?? input.serviceBps ?? input.barber.serviceCommissionBps;
    case 'PRODUCT':
      return input.productBps ?? input.barber.productCommissionBps;
    case 'TIP':
      return input.barber.tipCommissionBps;
  }
}

/** Comisión = base × tasa, redondeada al centavo hacia abajo. La base es lo cobrado en la línea. */
export function commissionAmount(baseCents: bigint, rateBps: number): bigint {
  if (baseCents <= 0n || rateBps <= 0) return 0n;
  return (baseCents * BigInt(rateBps)) / 10_000n;
}

export interface LineInput {
  quantity: number;
  unitPriceCents: bigint;
  discountCents: bigint;
}

export function lineTotal(line: LineInput): bigint {
  return BigInt(line.quantity) * line.unitPriceCents - line.discountCents;
}

export function saleTotals(lines: LineInput[]) {
  let subtotal = 0n;
  let discount = 0n;
  for (const l of lines) {
    subtotal += BigInt(l.quantity) * l.unitPriceCents;
    discount += l.discountCents;
  }
  return { subtotalCents: subtotal, discountCents: discount, totalCents: subtotal - discount };
}

/**
 * Los pagos de un cobro tienen que sumar exactamente lo que falta (el vuelto del efectivo se
 * calcula en pantalla y no se registra). Devuelve el problema en español o null.
 */
export function paymentsProblem(remainingCents: bigint, amounts: bigint[]): string | null {
  const sum = amounts.reduce((a, b) => a + b, 0n);
  if (amounts.some((a) => a <= 0n)) return 'Cada pago tiene que ser mayor a $0.';
  if (sum !== remainingCents) {
    const fmt = (c: bigint) => `$${(Number(c) / 100).toLocaleString('es-AR')}`;
    return `Los pagos suman ${fmt(sum)} y hay que cobrar ${fmt(remainingCents)}.`;
  }
  return null;
}

export interface CashFlows {
  method: string;
  sales: bigint;
  refunds: bigint;
  expenses: bigint;
  /** Aportes − retiros (solo efectivo). */
  movements: bigint;
}

/** Lo que debería haber por medio de pago al cerrar. El efectivo suma el inicial. */
export function expectedByMethod(openingCashCents: bigint, flows: CashFlows): bigint {
  const base = flows.sales - flows.refunds - flows.expenses + flows.movements;
  return flows.method === 'CASH' ? openingCashCents + base : base;
}
