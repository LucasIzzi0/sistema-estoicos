import { customersWithExpiredPoints, expirePointsFor } from '@estoicos/core';
import type { CustomerPoints, MyPoints, RewardDto, SaleDetail, SaleLoyalty } from '@estoicos/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  codeFromEmail,
  createTestContext,
  inviteAndAccept,
  loginStaff,
  PRECIO,
  sessionCookie,
  type TestContext,
} from './helpers';

/**
 * Fase 7: puntos y recompensas. Regla del fundador: 1 punto cada $1.000, corte gratis a los
 * 200 puntos (8 cortes de $25.000), vencimiento a los 12 meses.
 */
const NOW = new Date('2026-10-13T12:00:00-03:00');
/** 1 punto cada $1.000: un corte de $25.000 da 25 puntos. */
const PUNTOS_CORTE = PRECIO.corte / 100_000;
const PUNTOS_CERA = PRECIO.ceraMate / 100_000;
/** El corte gratis cuesta 8 cortes. */
const CORTE_GRATIS = PUNTOS_CORTE * 8;

let ctx: TestContext;
let owner: string;
let reception: string;
let juan: string;
const services: Record<string, string> = {};
const products: Record<string, string> = {};
let customerId: string;
let rewards: RewardDto[];

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
  rewards = (await api('GET', '/v1/rewards')).json();
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  ctx.clock.now = NOW;
  await ctx.redis.flushdb();
});

function api(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  payload?: unknown,
  cookie: string | undefined = owner,
) {
  return ctx.inject({ method, url, cookie, ...(payload === undefined ? {} : { payload: payload as object }) });
}

const B = () => ctx.ids.branchId;
const rewardBy = (name: string) => rewards.find((r) => r.name === name)!;

async function openCash() {
  const current = await api('GET', `/v1/branches/${B()}/cash/current`);
  if (!current.json().session) await api('POST', `/v1/branches/${B()}/cash`, { openingCashCents: 1_000_000 });
}

/** Venta de mostrador con un corte, lista para cobrar. */
async function saleWithCorte(customer: string | null = customerId): Promise<SaleDetail> {
  const sale: SaleDetail = (await api('POST', `/v1/branches/${B()}/sales`, { customerId: customer })).json();
  const r = await api('POST', `/v1/sales/${sale.id}/items`, {
    type: 'SERVICE',
    serviceId: services.Corte,
    barberId: juan,
  });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

async function paySale(sale: SaleDetail) {
  const fresh: SaleDetail = (await api('GET', `/v1/sales/${sale.id}`)).json();
  // Una venta que quedó en $0 por un canje se cierra sin cobros.
  const payments =
    fresh.remainingCents > 0 ? [{ method: 'CASH', amountCents: fresh.remainingCents }] : [];
  const r = await api('POST', `/v1/sales/${sale.id}/pay`, { payments });
  expect(r.statusCode, r.body).toBe(200);
  return r.json() as SaleDetail;
}

const balanceOf = async () => ((await api('GET', `/v1/customers/${customerId}/points`)).json() as CustomerPoints).balance;

describe('acreditación', () => {
  it('un corte de $25.000 suma 25 puntos al cobrarse, no antes', async () => {
    await openCash();
    const before = await balanceOf();
    const sale = await saleWithCorte();
    expect(await balanceOf()).toBe(before);

    await paySale(sale);
    expect(await balanceOf()).toBe(before + PUNTOS_CORTE);
    const entry = await ctx.db.pointsEntry.findFirstOrThrow({ where: { saleId: sale.id, type: 'EARN' } });
    expect(entry.idempotencyKey).toBe(`earn:${sale.id}`);
    // Vencen a los 12 meses.
    expect(entry.expiresAt?.toISOString().slice(0, 10)).toBe('2027-10-13');
  });

  it('la propina no suma y el producto sí', async () => {
    await openCash();
    const before = await balanceOf();
    const sale = await saleWithCorte();
    await api('POST', `/v1/sales/${sale.id}/items`, { type: 'TIP', barberId: juan, amountCents: 300_000 });
    await api('POST', `/v1/sales/${sale.id}/items`, { type: 'PRODUCT', productId: products['Cera mate'] });
    await paySale(sale);
    // El corte más la cera; la propina no cuenta.
    expect(await balanceOf()).toBe(before + PUNTOS_CORTE + PUNTOS_CERA);
  });

  it('una venta sin cliente no genera puntos', async () => {
    await openCash();
    const sale = await saleWithCorte(null);
    await paySale(sale);
    expect(await ctx.db.pointsEntry.count({ where: { saleId: sale.id } })).toBe(0);
  });

  it('el cliente recibe el aviso de puntos acreditados', async () => {
    const notification = await ctx.db.notification.findFirst({
      where: { type: 'POINTS_CREDITED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(notification).not.toBeNull();
    const payload = notification!.payload as { points: number; balance: number; nextReward: { name: string } | null };
    expect(payload.points).toBeGreaterThan(0);
    expect(payload.balance).toBeGreaterThan(0);
  });
});

describe('canje en el cobro', () => {
  it('sin puntos suficientes no se puede canjear', async () => {
    await openCash();
    const sale = await saleWithCorte();
    const r = await api('POST', `/v1/sales/${sale.id}/loyalty/redeem`, { rewardId: rewardBy('Corte gratis').id });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.message).toContain('Le faltan');
    await api('POST', `/v1/sales/${sale.id}/void`, { reason: 'prueba' });
  });

  it('con saldo, el corte gratis deja la venta en $0 y descuenta los puntos', async () => {
    await api('POST', `/v1/customers/${customerId}/points/adjust`, {
      points: 200,
      reason: 'Carga para probar el canje',
    });
    await openCash();
    const before = await balanceOf();
    const sale = await saleWithCorte();

    const available: SaleLoyalty = (await api('GET', `/v1/sales/${sale.id}/loyalty`)).json();
    const corteGratis = available.rewards.find((r) => r.name === 'Corte gratis')!;
    expect(corteGratis.affordable).toBe(true);
    expect(corteGratis.applicableItemIds).toHaveLength(1);

    const r = await api('POST', `/v1/sales/${sale.id}/loyalty/redeem`, { rewardId: corteGratis.id });
    expect(r.statusCode, r.body).toBe(200);
    expect(await balanceOf()).toBe(before - CORTE_GRATIS);

    const withDiscount: SaleDetail = (await api('GET', `/v1/sales/${sale.id}`)).json();
    expect(withDiscount.totalCents).toBe(0);
    expect(withDiscount.items[0]!.discountReason).toBe('Corte gratis');

    // Una venta en $0 se cierra sin cobros.
    const paid = await api('POST', `/v1/sales/${sale.id}/pay`, { payments: [] });
    expect(paid.statusCode, paid.body).toBe(200);
    expect(paid.json().status).toBe('PAID');
    // Y no suma puntos (no se gastó nada).
    expect(await balanceOf()).toBe(before - CORTE_GRATIS);
  });

  it('el barbero igual cobra su comisión sobre el precio de lista (P27)', async () => {
    const sale = await ctx.db.sale.findFirstOrThrow({
      where: { status: 'PAID', rewardRedemptions: { some: { status: 'APPLIED' } } },
      orderBy: { createdAt: 'desc' },
    });
    const commission = await ctx.db.commissionEntry.findFirstOrThrow({ where: { saleId: sale.id } });
    // El cliente no pagó nada, pero la comisión va sobre los $15.000 del corte.
    expect(commission.baseCents).toBe(BigInt(PRECIO.corte));
    expect(commission.amountCents).toBeGreaterThan(0n);
  });

  it('deshacer el canje devuelve los puntos y el precio', async () => {
    await openCash();
    const before = await balanceOf();
    const sale = await saleWithCorte();
    await api('POST', `/v1/sales/${sale.id}/loyalty/redeem`, { rewardId: rewardBy('20 % de descuento').id });
    expect(await balanceOf()).toBe(before - 40);
    const discounted: SaleDetail = (await api('GET', `/v1/sales/${sale.id}`)).json();
    expect(discounted.totalCents).toBe(PRECIO.corte * 0.8);

    const loyalty: SaleLoyalty = (await api('GET', `/v1/sales/${sale.id}/loyalty`)).json();
    const undo = await api('DELETE', `/v1/sales/${sale.id}/loyalty/${loyalty.redemptions[0]!.id}`);
    expect(undo.statusCode, undo.body).toBe(200);
    expect(await balanceOf()).toBe(before);
    const restored: SaleDetail = (await api('GET', `/v1/sales/${sale.id}`)).json();
    expect(restored.totalCents).toBe(PRECIO.corte);
    await api('POST', `/v1/sales/${sale.id}/void`, { reason: 'prueba' });
  });

  it('dos canjes simultáneos con saldo para uno solo: se aplica uno', async () => {
    // Saldo exacto para un solo corte gratis.
    const current = await balanceOf();
    await api('POST', `/v1/customers/${customerId}/points/adjust`, {
      points: CORTE_GRATIS - current,
      reason: 'Dejar saldo exacto',
    });
    expect(await balanceOf()).toBe(CORTE_GRATIS);

    await openCash();
    const a = await saleWithCorte();
    const b = await saleWithCorte();
    const results = await Promise.all([
      api('POST', `/v1/sales/${a.id}/loyalty/redeem`, { rewardId: rewardBy('Corte gratis').id }),
      api('POST', `/v1/sales/${b.id}/loyalty/redeem`, { rewardId: rewardBy('Corte gratis').id }),
    ]);
    const codes = results.map((r) => r.statusCode).sort();
    expect(codes).toEqual([200, 409]);
    expect(await balanceOf()).toBe(0);
    for (const sale of [a, b]) await api('POST', `/v1/sales/${sale.id}/void`, { reason: 'prueba' });
  });
});

describe('anulación', () => {
  it('anular una venta revierte los puntos ganados', async () => {
    await openCash();
    const before = await balanceOf();
    const sale = await saleWithCorte();
    await paySale(sale);
    expect(await balanceOf()).toBe(before + PUNTOS_CORTE);

    const r = await api('POST', `/v1/sales/${sale.id}/void`, { reason: 'Se equivocó el cobro' });
    expect(r.statusCode, r.body).toBe(200);
    expect(await balanceOf()).toBe(before);
    // El ledger no se edita: queda la fila de reversa.
    const entries = await ctx.db.pointsEntry.findMany({ where: { saleId: sale.id } });
    expect(entries.map((e) => e.type).sort()).toEqual(['EARN', 'REVERSAL']);
  });

  it('anular una venta con canje devuelve los puntos gastados', async () => {
    await api('POST', `/v1/customers/${customerId}/points/adjust`, { points: 200, reason: 'Carga' });
    await openCash();
    const before = await balanceOf();
    const sale = await saleWithCorte();
    await api('POST', `/v1/sales/${sale.id}/loyalty/redeem`, { rewardId: rewardBy('Corte gratis').id });
    await paySale((await api('GET', `/v1/sales/${sale.id}`)).json());
    expect(await balanceOf()).toBe(before - CORTE_GRATIS);

    await api('POST', `/v1/sales/${sale.id}/void`, { reason: 'Anulación con canje' });
    expect(await balanceOf()).toBe(before);
    const redemption = await ctx.db.rewardRedemption.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(redemption.status).toBe('REVERSED');
  });

  it('si ya gastó los puntos, el saldo puede quedar negativo (P43)', async () => {
    await openCash();
    // Se deja el saldo en 0 y se cobra una venta que suma 15.
    const current = await balanceOf();
    if (current !== 0) {
      await api('POST', `/v1/customers/${customerId}/points/adjust`, { points: -current, reason: 'A cero' });
    }
    const sale = await saleWithCorte();
    await paySale(sale);
    expect(await balanceOf()).toBe(PUNTOS_CORTE);

    // Los gasta en un ajuste (como si canjeara algo) y después se anula la venta.
    await api('POST', `/v1/customers/${customerId}/points/adjust`, { points: -PUNTOS_CORTE, reason: 'Gastados' });
    await api('POST', `/v1/sales/${sale.id}/void`, { reason: 'Anulada después de gastar' });
    expect(await balanceOf()).toBe(-PUNTOS_CORTE);
  });
});

describe('vencimiento', () => {
  it('vence lo vencido, y correrlo dos veces no vence de más', async () => {
    const customer = await ctx.db.customer.findFirstOrThrow({ where: { firstName: 'Lucas' } });
    await ctx.db.pointsEntry.create({
      data: {
        organizationId: ctx.ids.organizationId,
        customerId: customer.id,
        type: 'EARN',
        points: 100,
        expiresAt: new Date('2026-09-01T00:00:00Z'),
        idempotencyKey: `test-earn:${customer.id}`,
      },
    });
    expect(await customersWithExpiredPoints(ctx.deps, NOW)).toContain(customer.id);

    const first = await expirePointsFor(ctx.deps, customer.id, NOW);
    expect(first.expired).toBe(100);
    const second = await expirePointsFor(ctx.deps, customer.id, NOW);
    expect(second.expired).toBe(0);

    const rows = await ctx.db.pointsEntry.findMany({ where: { customerId: customer.id } });
    expect(rows.reduce((a, e) => a + e.points, 0)).toBe(0);
    expect(rows.filter((e) => e.type === 'EXPIRE')).toHaveLength(1);
  });

  it('lo que todavía no venció se queda', async () => {
    const customer = await ctx.db.customer.findFirstOrThrow({ where: { firstName: 'Tomás' } });
    await ctx.db.pointsEntry.create({
      data: {
        organizationId: ctx.ids.organizationId,
        customerId: customer.id,
        type: 'EARN',
        points: 40,
        expiresAt: new Date('2027-10-01T00:00:00Z'),
        idempotencyKey: `test-future:${customer.id}`,
      },
    });
    expect((await expirePointsFor(ctx.deps, customer.id, NOW)).expired).toBe(0);
  });
});

describe('permisos y ledger', () => {
  it('recepción no ajusta puntos ni toca el catálogo', async () => {
    expect(
      (await api('POST', `/v1/customers/${customerId}/points/adjust`, { points: 10, reason: 'x' }, reception)).statusCode,
    ).toBe(403);
    expect((await api('GET', '/v1/rewards', undefined, reception)).statusCode).toBe(403);
  });

  it('el ajuste exige motivo y queda auditado', async () => {
    expect((await api('POST', `/v1/customers/${customerId}/points/adjust`, { points: 10, reason: '' })).statusCode).toBe(422);
    const r = await api('POST', `/v1/customers/${customerId}/points/adjust`, { points: 10, reason: 'Regalo de cumpleaños' });
    expect(r.statusCode, r.body).toBe(200);
    const audit = await ctx.db.auditLog.findFirst({
      where: { action: 'POINTS_ADJUSTED', entityId: customerId, reason: 'Regalo de cumpleaños' },
    });
    expect(audit).not.toBeNull();
  });

  it('dos ajustes seguidos al mismo cliente entran los dos', async () => {
    const before = await balanceOf();
    for (const points of [5, 7]) {
      const r = await api('POST', `/v1/customers/${customerId}/points/adjust`, { points, reason: 'Ajuste de prueba' });
      expect(r.statusCode, r.body).toBe(200);
    }
    expect(await balanceOf()).toBe(before + 12);
  });

  it('el ledger es de solo inserción: la base rechaza editarlo', async () => {
    const entry = await ctx.db.pointsEntry.findFirstOrThrow();
    await expect(
      ctx.db.pointsEntry.update({ where: { id: entry.id }, data: { points: 9999 } }),
    ).rejects.toThrow();
    await expect(ctx.db.pointsEntry.delete({ where: { id: entry.id } })).rejects.toThrow();
  });
});

describe('portal del cliente', () => {
  it('muestra el saldo y qué le falta para cada recompensa', async () => {
    const email = 'martin.gomez@example.com';
    await ctx.inject({ method: 'POST', url: '/v1/auth/customer/request-code', payload: { email } });
    const cookie = sessionCookie(
      await ctx.inject({
        method: 'POST',
        url: '/v1/auth/customer/verify-code',
        payload: { email, code: codeFromEmail(ctx.mailer) },
      }),
    );
    const r = await ctx.inject({ method: 'GET', url: '/v1/me/points', cookie });
    expect(r.statusCode, r.body).toBe(200);
    const points: MyPoints = r.json();
    expect(points.enabled).toBe(true);
    expect(points.rewards.map((x) => x.name)).toContain('Corte gratis');
    const corte = points.rewards.find((x) => x.name === 'Corte gratis')!;
    expect(corte.pointsCost).toBe(CORTE_GRATIS);
    expect(corte.missingPoints).toBe(Math.max(CORTE_GRATIS - points.balance, 0));
  });
});
