import { describe, expect, it } from 'vitest';
import {
  commissionAmount,
  commissionRateBps,
  expectedByMethod,
  lineTotal,
  paymentsProblem,
  saleTotals,
} from './calc';

const barber = { serviceCommissionBps: 5000, productCommissionBps: 1000, tipCommissionBps: 0 };

describe('tasa de comisión (prioridades)', () => {
  it('servicios: barbero+servicio → servicio → barbero', () => {
    expect(commissionRateBps({ itemType: 'SERVICE', barber })).toBe(5000);
    expect(commissionRateBps({ itemType: 'SERVICE', barber, serviceBps: 4000 })).toBe(4000);
    expect(commissionRateBps({ itemType: 'SERVICE', barber, serviceBps: 4000, barberServiceBps: 6000 })).toBe(
      6000,
    );
    // Un override en 0 también es un valor válido (no cae al siguiente).
    expect(commissionRateBps({ itemType: 'SERVICE', barber, barberServiceBps: 0, serviceBps: 4000 })).toBe(0);
  });

  it('productos: producto → barbero; propinas: las del barbero (0 = para la casa)', () => {
    expect(commissionRateBps({ itemType: 'PRODUCT', barber })).toBe(1000);
    expect(commissionRateBps({ itemType: 'PRODUCT', barber, productBps: 1500 })).toBe(1500);
    expect(commissionRateBps({ itemType: 'TIP', barber })).toBe(0);
    expect(commissionRateBps({ itemType: 'TIP', barber: { ...barber, tipCommissionBps: 10_000 } })).toBe(
      10_000,
    );
  });
});

describe('monto de comisión', () => {
  it('base × tasa, al centavo hacia abajo', () => {
    expect(commissionAmount(1_500_000n, 5000)).toBe(750_000n);
    // $123,45 al 33,33 % = $41,1458… → $41,14
    expect(commissionAmount(12_345n, 3333)).toBe(4_114n);
    expect(commissionAmount(1n, 9999)).toBe(0n);
  });

  it('sobre lo cobrado después del descuento', () => {
    const base = lineTotal({ quantity: 1, unitPriceCents: 1_500_000n, discountCents: 300_000n });
    expect(commissionAmount(base, 5000)).toBe(600_000n);
  });

  it('sin base o sin tasa no hay comisión', () => {
    expect(commissionAmount(0n, 5000)).toBe(0n);
    expect(commissionAmount(1_000n, 0)).toBe(0n);
  });
});

describe('totales de la venta', () => {
  it('subtotal, descuentos y total', () => {
    expect(
      saleTotals([
        { quantity: 1, unitPriceCents: 1_500_000n, discountCents: 100_000n },
        { quantity: 2, unitPriceCents: 1_200_000n, discountCents: 0n },
      ]),
    ).toEqual({ subtotalCents: 3_900_000n, discountCents: 100_000n, totalCents: 3_800_000n });
  });
});

describe('pagos de un cobro', () => {
  it('tienen que sumar exactamente lo que falta', () => {
    expect(paymentsProblem(2_000_000n, [1_500_000n, 500_000n])).toBeNull();
    expect(paymentsProblem(2_000_000n, [1_500_000n])).toContain('hay que cobrar');
    expect(paymentsProblem(2_000_000n, [2_500_000n])).toContain('suman');
    expect(paymentsProblem(0n, [])).toBeNull();
  });
});

describe('esperado de caja', () => {
  it('efectivo: inicial + ventas − reintegros − egresos + aportes − retiros', () => {
    expect(
      expectedByMethod(1_000_000n, {
        method: 'CASH',
        sales: 5_000_000n,
        refunds: 200_000n,
        expenses: 300_000n,
        movements: -1_000_000n,
      }),
    ).toBe(4_500_000n);
  });

  it('otros medios: sin el inicial', () => {
    expect(
      expectedByMethod(1_000_000n, {
        method: 'TRANSFER',
        sales: 800_000n,
        refunds: 0n,
        expenses: 0n,
        movements: 0n,
      }),
    ).toBe(800_000n);
  });
});
