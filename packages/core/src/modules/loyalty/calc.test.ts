import { describe, expect, it } from 'vitest';
import {
  balanceOf,
  commissionBaseForRedeemedLine,
  expiryFor,
  pointsForSale,
  pointsToExpire,
  rewardDiscountFor,
  type EarnLine,
  type LedgerEntry,
  type LoyaltyRule,
} from './calc';

// 1 punto cada $1.000 (decisión del 28/09/2026), productos suman, vencen a los 12 meses.
const RULE: LoyaltyRule = {
  pointsPerStep: 1,
  spendStepCents: 100_000n,
  earnOnProducts: true,
  expiryMonths: 12,
};

const line = (over: Partial<EarnLine> = {}): EarnLine => ({
  type: 'SERVICE',
  totalCents: 1_500_000n,
  quantity: 1,
  pointsOverride: null,
  ...over,
});

describe('puntos que gana una venta', () => {
  it('1 punto cada $1.000: un corte de $15.000 da 15', () => {
    expect(pointsForSale([line()], RULE)).toBe(15);
  });

  it('suma servicios y productos, y redondea hacia abajo', () => {
    // $15.000 + $12.000 = $27.000 → 27 puntos
    expect(pointsForSale([line(), line({ type: 'PRODUCT', totalCents: 1_200_000n })], RULE)).toBe(27);
    // $9.900 → 9 puntos (no 9,9)
    expect(pointsForSale([line({ totalCents: 990_000n })], RULE)).toBe(9);
  });

  it('las propinas no dan puntos', () => {
    expect(pointsForSale([line(), line({ type: 'TIP', totalCents: 500_000n })], RULE)).toBe(15);
  });

  it('con los productos apagados, solo suman los servicios', () => {
    const rule = { ...RULE, earnOnProducts: false };
    expect(pointsForSale([line(), line({ type: 'PRODUCT', totalCents: 1_200_000n })], rule)).toBe(15);
  });

  it('un servicio con puntos propios usa ese valor por unidad', () => {
    expect(pointsForSale([line({ pointsOverride: 50 })], RULE)).toBe(50);
    expect(pointsForSale([line({ type: 'PRODUCT', pointsOverride: 5, quantity: 3 })], RULE)).toBe(15);
    // Se combinan: uno con puntos propios y otro por monto.
    expect(pointsForSale([line({ pointsOverride: 50 }), line({ totalCents: 900_000n })], RULE)).toBe(59);
  });

  it('el descuento baja los puntos: se cuenta lo cobrado', () => {
    expect(pointsForSale([line({ totalCents: 1_200_000n })], RULE)).toBe(12);
  });

  it('una venta de $0 no da puntos', () => {
    expect(pointsForSale([line({ totalCents: 0n })], RULE)).toBe(0);
  });
});

describe('vencimiento', () => {
  it('12 meses desde que se ganan', () => {
    expect(expiryFor(new Date('2026-09-28T12:00:00Z'), 12)?.toISOString()).toBe('2027-09-28T12:00:00.000Z');
    expect(expiryFor(new Date('2026-09-28T12:00:00Z'), null)).toBeNull();
  });
});

describe('ledger y vencimiento FIFO', () => {
  const at = (iso: string) => new Date(iso);
  const NOW = at('2027-10-01T00:00:00Z');

  it('el saldo es la suma de las filas', () => {
    expect(balanceOf([{ points: 15 }, { points: 12 }, { points: -20 }])).toBe(7);
  });

  it('vence lo que ya venció y todavía no se gastó', () => {
    const entries: LedgerEntry[] = [
      { points: 100, expiresAt: at('2027-09-01T00:00:00Z'), createdAt: at('2026-09-01T00:00:00Z') },
      { points: 50, expiresAt: at('2028-01-01T00:00:00Z'), createdAt: at('2027-01-01T00:00:00Z') },
    ];
    expect(pointsToExpire(entries, NOW)).toBe(100);
  });

  it('lo ya gastado no vuelve a vencer (FIFO)', () => {
    const entries: LedgerEntry[] = [
      { points: 100, expiresAt: at('2027-09-01T00:00:00Z'), createdAt: at('2026-09-01T00:00:00Z') },
      { points: -60, expiresAt: null, createdAt: at('2027-02-01T00:00:00Z') },
    ];
    expect(pointsToExpire(entries, NOW)).toBe(40);
  });

  it('correrlo dos veces no vence de más', () => {
    const entries: LedgerEntry[] = [
      { points: 100, expiresAt: at('2027-09-01T00:00:00Z'), createdAt: at('2026-09-01T00:00:00Z') },
    ];
    const first = pointsToExpire(entries, NOW);
    expect(first).toBe(100);
    // Se registra el vencimiento como un débito y se vuelve a calcular: ya no hay nada que vencer.
    const after = [...entries, { points: -first, expiresAt: null, createdAt: NOW }];
    expect(pointsToExpire(after, NOW)).toBe(0);
    expect(balanceOf(after)).toBe(0);
  });

  it('nunca vence más que el saldo', () => {
    const entries: LedgerEntry[] = [
      { points: 100, expiresAt: at('2027-09-01T00:00:00Z'), createdAt: at('2026-09-01T00:00:00Z') },
      { points: -120, expiresAt: null, createdAt: at('2027-02-01T00:00:00Z') },
    ];
    // El saldo quedó negativo (P43): no hay nada más para vencer.
    expect(pointsToExpire(entries, NOW)).toBe(0);
  });

  it('los puntos sin vencimiento nunca vencen', () => {
    const entries: LedgerEntry[] = [{ points: 80, expiresAt: null, createdAt: at('2020-01-01T00:00:00Z') }];
    expect(pointsToExpire(entries, NOW)).toBe(0);
  });
});

describe('descuento de una recompensa', () => {
  const service = { serviceId: 'corte', productId: null, totalCents: 1_500_000n, unitPriceCents: 1_500_000n };

  it('corte gratis descuenta el corte entero', () => {
    const reward = {
      type: 'FREE_SERVICE' as const,
      serviceId: 'corte',
      productId: null,
      discountFixedCents: null,
      discountPercentBps: null,
    };
    expect(rewardDiscountFor(reward, service)).toBe(1_500_000n);
    // No aplica a otro servicio.
    expect(rewardDiscountFor(reward, { ...service, serviceId: 'barba' })).toBeNull();
  });

  it('un porcentaje descuenta sobre lo que queda de la línea', () => {
    const reward = {
      type: 'PERCENT_DISCOUNT' as const,
      serviceId: null,
      productId: null,
      discountFixedCents: null,
      discountPercentBps: 2000,
    };
    expect(rewardDiscountFor(reward, service)).toBe(300_000n);
  });

  it('un descuento fijo nunca supera el precio de la línea', () => {
    const reward = {
      type: 'FIXED_DISCOUNT' as const,
      serviceId: null,
      productId: null,
      discountFixedCents: 5_000_000n,
      discountPercentBps: null,
    };
    expect(rewardDiscountFor(reward, service)).toBe(1_500_000n);
  });

  it('en una línea ya descontada, el regalo no la deja en negativo', () => {
    const reward = {
      type: 'FREE_SERVICE' as const,
      serviceId: 'corte',
      productId: null,
      discountFixedCents: null,
      discountPercentBps: null,
    };
    const conDescuento = { ...service, totalCents: 1_200_000n };
    expect(rewardDiscountFor(reward, conDescuento)).toBe(1_200_000n);
  });
});

describe('comisión de una línea canjeada', () => {
  it('por defecto se paga sobre el precio de lista (P27)', () => {
    expect(commissionBaseForRedeemedLine('LIST_PRICE', { grossCents: 1_500_000n, chargedCents: 0n })).toBe(
      1_500_000n,
    );
    expect(commissionBaseForRedeemedLine('CHARGED_AMOUNT', { grossCents: 1_500_000n, chargedCents: 0n })).toBe(0n);
  });
});
