import type {
  BarberCommissionSummary,
  CashSessionDto,
  MonthlyResult,
  SaleDetail,
  SettlementDto,
  StockItem,
} from '@estoicos/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  createTestContext,
  inviteAndAccept,
  loginStaff,
  PRECIO,
  type TestContext,
} from './helpers';

/**
 * Fase 4: cobros, caja, stock, egresos y comisiones.
 * Reloj fijo: martes 13/10/2026 10:30 en Buenos Aires. Juan cobra 50 % de servicios y 10 % de
 * productos; las propinas quedan para la casa (0 %).
 */
const NOW = new Date('2026-10-13T10:30:00-03:00');
const TUESDAY = '2026-10-13';

let ctx: TestContext;
let owner: string;
let reception: string;
let juan: string;
const services: Record<string, string> = {};
const products: Record<string, string> = {};
let customerId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  ctx.clock.now = NOW;
  owner = await loginStaff(ctx, ADMIN_EMAIL);
  reception = await inviteAndAccept(ctx, owner, {
    email: 'recepcion@estoicos.test',
    role: 'RECEPTION',
    branchIds: [ctx.ids.branchId],
  });
  juan = ctx.ids.barberIds[0]!;
  for (const s of await ctx.db.service.findMany()) services[s.name] = s.id;
  for (const p of await ctx.db.product.findMany()) products[p.name] = p.id;
  customerId = (await ctx.db.customer.findFirstOrThrow({ where: { firstName: 'Martín' } })).id;
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  ctx.clock.now = NOW;
  await ctx.redis.flushdb();
});

const api = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  cookie = owner,
  headers?: Record<string, string>,
) =>
  ctx.inject({
    method,
    url,
    cookie,
    headers,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });

const B = () => ctx.ids.branchId;

async function stockOf(name: string): Promise<number> {
  const list: StockItem[] = (await api('GET', `/v1/branches/${B()}/stock`)).json();
  return list.find((s) => s.name === name)!.stockOnHand;
}

async function appointmentAt(time: string, serviceIds = [services.Corte]) {
  const r = await api('POST', `/v1/branches/${B()}/appointments`, {
    barberId: juan,
    customerId,
    serviceIds,
    date: TUESDAY,
    time,
    force: true,
  });
  expect(r.statusCode, r.body).toBe(201);
  return r.json().id as string;
}

async function currentCash(): Promise<CashSessionDto | null> {
  return (await api('GET', `/v1/branches/${B()}/cash/current`)).json().session;
}

/** La venta que arman estos tests: corte + barba del turno, 2 ceras y $2.000 de propina. */
const DESCUENTO = 300_000;
const TOTAL_VENTA = PRECIO.corte + PRECIO.barba + 2 * PRECIO.ceraMate + 200_000 - DESCUENTO;
/** Comisiones que genera: 50 % de los servicios y 10 % del producto. La propina no comisiona. */
const COMISIONES = (PRECIO.corte - DESCUENTO) / 2 + PRECIO.barba / 2 + (2 * PRECIO.ceraMate) / 10;

describe('caja y cobro', () => {
  let saleId: string;
  let appointmentId: string;

  it('sin caja abierta no se cobra (P25)', async () => {
    appointmentId = await appointmentAt('10:00', [services.Corte, services.Barba]);
    const sale: SaleDetail = (
      await api('POST', `/v1/appointments/${appointmentId}/sale`, undefined, reception)
    ).json();
    saleId = sale.id;
    const r = await api(
      'POST',
      `/v1/sales/${saleId}/pay`,
      { payments: [{ method: 'CASH', amountCents: sale.totalCents }] },
      reception,
    );
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('CASH_CLOSED');
  });

  it('recepción abre la caja; no puede haber dos abiertas', async () => {
    const r = await api('POST', `/v1/branches/${B()}/cash`, { openingCashCents: 1_000_000 }, reception);
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ status: 'OPEN', businessDate: TUESDAY, openingCashCents: 1_000_000 });
    expect((await api('POST', `/v1/branches/${B()}/cash`, { openingCashCents: 0 })).statusCode).toBe(409);
  });

  it('"cerrar servicio" usa el precio reservado y dos clics no crean dos ventas', async () => {
    await ctx.db.service.update({ where: { id: services.Corte! }, data: { basePriceCents: 9_999_900n } });
    const again: SaleDetail = (
      await api('POST', `/v1/appointments/${appointmentId}/sale`, undefined, reception)
    ).json();
    expect(again.id).toBe(saleId);
    expect(again.items.map((i) => [i.description, i.unitPriceCents, i.fromAppointment])).toEqual([
      ['Corte', PRECIO.corte, true],
      ['Barba', PRECIO.barba, true],
    ]);
    await ctx.db.service.update({
      where: { id: services.Corte! },
      data: { basePriceCents: BigInt(PRECIO.corte) },
    });
  });

  it('productos, propina y descuento (solo dueño/encargado, con motivo y auditado)', async () => {
    let r = await api(
      'POST',
      `/v1/sales/${saleId}/items`,
      { type: 'PRODUCT', productId: products['Cera mate'], quantity: 1, barberId: juan },
      reception,
    );
    expect(r.statusCode, r.body).toBe(200);
    // El mismo producto suma cantidad en la misma línea.
    r = await api(
      'POST',
      `/v1/sales/${saleId}/items`,
      { type: 'PRODUCT', productId: products['Cera mate'], quantity: 1, barberId: juan },
      reception,
    );
    expect(r.json().items.find((i: { description: string }) => i.description === 'Cera mate').quantity).toBe(
      2,
    );
    r = await api(
      'POST',
      `/v1/sales/${saleId}/items`,
      { type: 'TIP', barberId: juan, amountCents: 200_000 },
      reception,
    );
    const corte = (r.json() as SaleDetail).items.find((i) => i.description === 'Corte')!;

    expect(
      (
        await api(
          'PATCH',
          `/v1/sales/${saleId}/items/${corte.id}`,
          { discountCents: 300_000, discountReason: 'Cliente frecuente' },
          reception,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (await api('PATCH', `/v1/sales/${saleId}/items/${corte.id}`, { discountCents: 300_000 })).statusCode,
    ).toBe(422);
    r = await api('PATCH', `/v1/sales/${saleId}/items/${corte.id}`, {
      discountCents: 300_000,
      discountReason: 'Cliente frecuente',
    });
    expect(r.statusCode, r.body).toBe(200);
    const sale: SaleDetail = r.json();
    // corte + barba + 2 × cera + propina, menos $3.000 de descuento en el corte
    const subtotal = TOTAL_VENTA + DESCUENTO;
    expect(sale).toMatchObject({
      subtotalCents: subtotal,
      discountCents: DESCUENTO,
      totalCents: TOTAL_VENTA,
      remainingCents: TOTAL_VENTA,
    });
    expect(
      await ctx.db.auditLog.count({ where: { action: 'SALE_DISCOUNT_APPLIED', entityId: saleId } }),
    ).toBe(1);
  });

  it('los pagos tienen que sumar exactamente lo que falta', async () => {
    const r = await api(
      'POST',
      `/v1/sales/${saleId}/pay`,
      { payments: [{ method: 'CASH', amountCents: 1_000_000 }] },
      reception,
    );
    expect(r.statusCode).toBe(422);
    expect(await ctx.db.payment.count({ where: { saleId } })).toBe(0);
  });

  it('doble clic en "Cobrar" (misma Idempotency-Key): un solo cobro y la misma respuesta', async () => {
    const stockBefore = await stockOf('Cera mate');
    // El total se cobra en dos medios: $30.000 en efectivo y el resto por transferencia.
    const body = {
      payments: [
        { method: 'CASH', amountCents: 3_000_000 },
        { method: 'TRANSFER', amountCents: TOTAL_VENTA - 3_000_000, reference: 'op 123' },
      ],
    };
    const headers = { 'idempotency-key': 'cobro-venta-1-abcdef' };
    const [a, b] = await Promise.all([
      api('POST', `/v1/sales/${saleId}/pay`, body, reception, headers),
      api('POST', `/v1/sales/${saleId}/pay`, body, reception, headers),
    ]);
    const codes = [a.statusCode, b.statusCode].sort();
    // El segundo espera la respuesta del primero (409 "se está procesando") o la recibe igual (200).
    expect(codes[0]).toBe(200);
    expect([200, 409]).toContain(codes[1]);
    const again = await api('POST', `/v1/sales/${saleId}/pay`, body, reception, headers);
    expect(again.statusCode).toBe(200);
    expect(again.json().id).toBe(saleId);
    expect(await ctx.db.payment.count({ where: { saleId } })).toBe(2);
    // Sin clave, un segundo intento choca con la venta ya cobrada.
    expect((await api('POST', `/v1/sales/${saleId}/pay`, body, reception)).statusCode).toBe(409);

    const sale: SaleDetail = again.json();
    expect(sale).toMatchObject({ status: 'PAID', paidCents: TOTAL_VENTA, remainingCents: 0 });
    expect(await stockOf('Cera mate')).toBe(stockBefore - 2);
  });

  it('al cobrar: turno atendido, comisiones por línea, stock y última visita (todo junto)', async () => {
    const appointment = await ctx.db.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
    expect(appointment.status).toBe('COMPLETED');
    const entries = await ctx.db.commissionEntry.findMany({
      where: { saleId },
      orderBy: { amountCents: 'desc' },
    });
    expect(entries.map((e) => [e.itemType, Number(e.baseCents), e.rateBps, Number(e.amountCents)])).toEqual([
      ['SERVICE', PRECIO.corte - 300_000, 5000, (PRECIO.corte - 300_000) / 2], // corte con descuento
      ['SERVICE', PRECIO.barba, 5000, PRECIO.barba / 2],
      ['PRODUCT', 2 * PRECIO.ceraMate, 1000, (2 * PRECIO.ceraMate) / 10],
    ]); // la propina no genera comisión (queda para la casa)
    const movement = await ctx.db.stockMovement.findFirstOrThrow({ where: { saleItem: { saleId } } });
    expect(movement).toMatchObject({ type: 'SALE', quantity: -2 });
    const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.lastVisitAt?.toISOString()).toBe(NOW.toISOString());
  });

  it('esperado de caja por medio de pago, con egreso y retiro', async () => {
    const session = (await currentCash())!;
    // Recepción no puede retirar efectivo.
    expect(
      (
        await api(
          'POST',
          `/v1/cash/${session.id}/movements`,
          { type: 'WITHDRAWAL', amountCents: 500_000, description: 'Retiro del dueño' },
          reception,
        )
      ).statusCode,
    ).toBe(403);
    await api('POST', `/v1/cash/${session.id}/movements`, {
      type: 'WITHDRAWAL',
      amountCents: 500_000,
      description: 'Retiro del dueño',
    });
    const categories = (await api('GET', '/v1/expense-categories')).json() as {
      id: string;
      systemKey: string | null;
    }[];
    const insumos = categories.find((c) => !c.systemKey)!;
    const exp = await api('POST', '/v1/expenses', {
      branchId: B(),
      categoryId: insumos.id,
      amountCents: 250_000,
      method: 'CASH',
      occurredOn: TUESDAY,
      description: 'Café y azúcar',
      fromCashSession: true,
    });
    expect(exp.statusCode, exp.body).toBe(201);
    const s = (await currentCash())!;
    const cash = s.totals.find((t) => t.method === 'CASH')!;
    // 10.000 inicial + 30.000 cobrados en efectivo − 2.500 de egreso − 5.000 de retiro
    expect(cash).toMatchObject({
      salesCents: 3_000_000,
      expensesCents: 250_000,
      movementsCents: -500_000,
      expectedCents: 1_000_000 + 3_000_000 - 250_000 - 500_000,
    });
    expect(s.totals.find((t) => t.method === 'TRANSFER')!.expectedCents).toBe(TOTAL_VENTA - 3_000_000);
  });
});

describe('stock', () => {
  it('ventas simultáneas del mismo producto descuentan exacto', async () => {
    const before = await stockOf('Shampoo');
    const sales = await Promise.all(
      Array.from({ length: 5 }, () => api('POST', `/v1/branches/${B()}/sales`, {}, reception)),
    );
    for (const s of sales) {
      await api(
        'POST',
        `/v1/sales/${s.json().id}/items`,
        { type: 'PRODUCT', productId: products.Shampoo },
        reception,
      );
    }
    const paid = await Promise.all(
      sales.map((s) =>
        api(
          'POST',
          `/v1/sales/${s.json().id}/pay`,
          { payments: [{ method: 'MP_POINT', amountCents: 950_000 }] },
          reception,
        ),
      ),
    );
    expect(paid.map((r) => r.statusCode)).toEqual([200, 200, 200, 200, 200]);
    expect(await stockOf('Shampoo')).toBe(before - 5);
    const numbers = sales.map((s) => s.json().number as number);
    expect(new Set(numbers).size).toBe(5); // numeración sin repetidos
  });

  it('compra, ajuste con motivo, mínimo y alerta de stock bajo', async () => {
    const url = `/v1/branches/${B()}/stock/${products['Aceite para barba']}`;
    let list: StockItem[] = (
      await api('POST', `${url}/purchases`, { quantity: 4, unitCostCents: 600_000 })
    ).json();
    let item = list.find((s) => s.name === 'Aceite para barba')!;
    expect(item).toMatchObject({ stockOnHand: 10, costCents: 600_000 });
    expect(
      (await api('POST', `${url}/adjustments`, { type: 'ADJUSTMENT_OUT', quantity: 1, reason: '' }))
        .statusCode,
    ).toBe(422);
    expect(
      (await api('POST', `${url}/adjustments`, { type: 'INTERNAL_USE', quantity: 1, reason: 'x' }, reception))
        .statusCode,
    ).toBe(403);
    await api('POST', `${url}/adjustments`, {
      type: 'INTERNAL_USE',
      quantity: 2,
      reason: 'Para usar en el local',
    });
    list = (await api('PUT', `${url}/min`, { minStock: 8 })).json();
    item = list.find((s) => s.name === 'Aceite para barba')!;
    expect(item).toMatchObject({ stockOnHand: 8, minStock: 8, low: true });
    const movements = (await api('GET', `${url}/movements`)).json() as { type: string }[];
    expect(movements.map((m) => m.type).slice(0, 2)).toEqual(['INTERNAL_USE', 'PURCHASE']);
  });
});

describe('anulación', () => {
  it('una venta cobrada se revierte sin borrar: reintegros, reversas de comisión y stock', async () => {
    const appointmentId = await appointmentAt('12:00');
    const sale: SaleDetail = (await api('POST', `/v1/appointments/${appointmentId}/sale`)).json();
    await api('POST', `/v1/sales/${sale.id}/items`, {
      type: 'PRODUCT',
      productId: products['Pomada brillo'],
      barberId: juan,
    });
    const total = (await api('GET', `/v1/sales/${sale.id}`)).json().totalCents;
    const stockBefore = await stockOf('Pomada brillo');
    await api('POST', `/v1/sales/${sale.id}/pay`, { payments: [{ method: 'CASH', amountCents: total }] });
    const cashBefore = (await currentCash())!.totals.find((t) => t.method === 'CASH')!.expectedCents;

    expect(
      (await api('POST', `/v1/sales/${sale.id}/void`, { reason: 'Error de carga' }, reception)).statusCode,
    ).toBe(403);
    const r = await api('POST', `/v1/sales/${sale.id}/void`, { reason: 'Error de carga' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ status: 'VOIDED', refundedCents: total });

    const entries = await ctx.db.commissionEntry.findMany({ where: { saleId: sale.id } });
    expect(entries.filter((e) => e.kind === 'REVERSAL')).toHaveLength(2);
    expect(entries.reduce((a, e) => a + e.amountCents, 0n)).toBe(0n);
    expect(await stockOf('Pomada brillo')).toBe(stockBefore);
    const cashAfter = (await currentCash())!.totals.find((t) => t.method === 'CASH')!.expectedCents;
    expect(cashBefore - cashAfter).toBe(total);
    expect(await ctx.db.auditLog.count({ where: { action: 'SALE_VOIDED', entityId: sale.id } })).toBe(1);
  });
});

describe('comisiones y liquidación', () => {
  let settlement: SettlementDto;

  it('resumen de pendientes por barbero y liquidación', async () => {
    const summary: BarberCommissionSummary[] = (
      await api('GET', `/v1/commissions/summary?until=${TUESDAY}`)
    ).json();
    const j = summary.find((s) => s.barberId === juan)!;
    // 6.000 + 4.500 + 2.400 (la venta anulada suma 0 con sus reversas)
    expect(j.pendingCents).toBe(COMISIONES);
    expect(
      (await api('GET', `/v1/commissions/summary?until=${TUESDAY}`, undefined, reception)).statusCode,
    ).toBe(403);

    const r = await api('POST', '/v1/settlements', {
      barberId: juan,
      periodStart: '2026-10-12',
      periodEnd: TUESDAY,
    });
    expect(r.statusCode, r.body).toBe(201);
    settlement = r.json();
    expect(settlement).toMatchObject({
      status: 'DRAFT',
      totalCents: COMISIONES,
      byType: {
        services: (PRECIO.corte - DESCUENTO) / 2 + PRECIO.barba / 2,
        products: (2 * PRECIO.ceraMate) / 10,
        tips: 0,
      },
    });
    // No se puede liquidar dos veces lo mismo.
    expect(
      (
        await api('POST', '/v1/settlements', {
          barberId: juan,
          periodStart: '2026-10-12',
          periodEnd: TUESDAY,
        })
      ).statusCode,
    ).toBe(422);
  });

  it('pagarla desde la caja crea el egreso de "Comisiones"; anularla deja todo pendiente otra vez', async () => {
    const cashBefore = (await currentCash())!.totals.find((t) => t.method === 'CASH')!.expectedCents;
    const paid = await api('POST', `/v1/settlements/${settlement.id}/pay`, {
      method: 'CASH',
      fromCashSessionBranchId: B(),
    });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().status).toBe('PAID');
    const expense = await ctx.db.expense.findUniqueOrThrow({
      where: { commissionSettlementId: settlement.id },
      include: { category: true },
    });
    expect(expense.category.systemKey).toBe('COMMISSIONS');
    expect((await currentCash())!.totals.find((t) => t.method === 'CASH')!.expectedCents).toBe(
      cashBefore - COMISIONES,
    );

    const voided = await api('POST', `/v1/settlements/${settlement.id}/void`, {
      reason: 'Me equivoqué de período',
    });
    expect(voided.json().status).toBe('VOIDED');
    expect((await ctx.db.expense.findUniqueOrThrow({ where: { id: expense.id } })).voidedAt).not.toBeNull();
    const summary: BarberCommissionSummary[] = (
      await api('GET', `/v1/commissions/summary?until=${TUESDAY}`)
    ).json();
    expect(summary.find((s) => s.barberId === juan)!.pendingCents).toBe(COMISIONES);
  });
});

describe('cierre de caja y resultado del mes', () => {
  it('solo dueño o encargado cierran; hay que contar todos los medios con movimiento', async () => {
    const session = (await currentCash())!;
    expect(
      (
        await api(
          'POST',
          `/v1/cash/${session.id}/close`,
          { counts: [{ method: 'CASH', countedCents: 0 }] },
          reception,
        )
      ).statusCode,
    ).toBe(403);
    const missing = await api('POST', `/v1/cash/${session.id}/close`, {
      counts: [{ method: 'CASH', countedCents: 0 }],
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.message).toContain('Transferencia');

    const expected = Object.fromEntries(session.totals.map((t) => [t.method, t.expectedCents]));
    const r = await api('POST', `/v1/cash/${session.id}/close`, {
      counts: [
        { method: 'CASH', countedCents: expected.CASH! - 10_000, note: 'Faltan $100' },
        { method: 'TRANSFER', countedCents: expected.TRANSFER! },
        { method: 'MP_POINT', countedCents: expected.MP_POINT! },
      ],
    });
    expect(r.statusCode, r.body).toBe(200);
    const closed: CashSessionDto = r.json();
    expect(closed.status).toBe('CLOSED');
    expect(closed.counts.find((c) => c.method === 'CASH')).toMatchObject({ differenceCents: -10_000 });
    expect(await currentCash()).toBeNull();
    expect(await ctx.db.auditLog.count({ where: { action: 'CASH_SESSION_CLOSED' } })).toBe(1);
  });

  it('resultado del mes: cobrado − reintegros − egresos', async () => {
    const r = await api('GET', '/v1/reports/monthly?month=2026-10');
    expect(r.statusCode, r.body).toBe(200);
    const m: MonthlyResult = r.json();
    // Lo cobrado de la venta grande más 5 ventas de shampoo (la anulada se reintegró).
    expect(m.incomeCents).toBe(TOTAL_VENTA + 5 * 950_000);
    // Egresos: café 2.500 (la liquidación anulada no cuenta)
    expect(m.expensesCents).toBe(250_000);
    expect(m.resultCents).toBe(m.incomeCents - m.expensesCents);
    expect(m.incomeByType.tips).toBe(200_000);
    expect(m.commissionsAccruedCents).toBe(COMISIONES + 5 * 0);
    expect((await api('GET', '/v1/reports/monthly?month=2026-10', undefined, reception)).statusCode).toBe(
      403,
    );
  });
});
