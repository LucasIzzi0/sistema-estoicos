import type { CashSessionDto, DashboardDto, ReportDto, SaleDetail } from '@estoicos/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  createTestContext,
  inviteAndAccept,
  loginStaff,
  PRECIO,
  type TestContext,
} from './helpers';

/**
 * Fase 8. El criterio del plan: **los números del dashboard tienen que coincidir con el cierre
 * de caja de un día real**. Acá se arma ese día y se verifica peso por peso.
 */
const TODAY = '2026-10-13';
const NOON = new Date('2026-10-13T12:00:00-03:00');

let ctx: TestContext;
let owner: string;
let manager: string;
let juan: string;
let pedro: string;
const services: Record<string, string> = {};
const products: Record<string, string> = {};
let customers: { id: string; firstName: string }[];

beforeAll(async () => {
  ctx = await createTestContext();
  ctx.clock.now = NOON;
  owner = await loginStaff(ctx, ADMIN_EMAIL);
  for (const s of await ctx.db.service.findMany()) services[s.name] = s.id;
  for (const p of await ctx.db.product.findMany()) products[p.name] = p.id;
  [juan, pedro] = ctx.ids.barberIds as [string, string];
  customers = await ctx.db.customer.findMany({ select: { id: true, firstName: true }, take: 4 });
  manager = await inviteAndAccept(ctx, owner, {
    email: 'encargado@estoicos.test',
    role: 'ADMIN',
    branchIds: [ctx.ids.branchId],
  });
});

afterAll(async () => {
  await ctx.close();
});

function api(
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  cookie: string | undefined = owner,
) {
  return ctx.inject({
    method,
    url,
    cookie,
    ...(payload === undefined ? {} : { payload: payload as object }),
  });
}

const B = () => ctx.ids.branchId;

/** Una venta cobrada: servicio (+ extras) con su barbero, pagada con el medio indicado. */
async function sell(input: {
  customerId?: string | null;
  serviceName?: string;
  barberId?: string;
  productName?: string;
  tipCents?: number;
  method?: 'CASH' | 'TRANSFER' | 'MP_POINT';
}) {
  const sale: SaleDetail = (
    await api('POST', `/v1/branches/${B()}/sales`, { customerId: input.customerId ?? null })
  ).json();
  if (input.serviceName) {
    await api('POST', `/v1/sales/${sale.id}/items`, {
      type: 'SERVICE',
      serviceId: services[input.serviceName],
      barberId: input.barberId ?? juan,
    });
  }
  if (input.productName) {
    await api('POST', `/v1/sales/${sale.id}/items`, {
      type: 'PRODUCT',
      productId: products[input.productName],
      barberId: input.barberId ?? juan,
    });
  }
  if (input.tipCents) {
    await api('POST', `/v1/sales/${sale.id}/items`, {
      type: 'TIP',
      barberId: input.barberId ?? juan,
      amountCents: input.tipCents,
    });
  }
  const fresh: SaleDetail = (await api('GET', `/v1/sales/${sale.id}`)).json();
  const paid = await api('POST', `/v1/sales/${sale.id}/pay`, {
    payments: [{ method: input.method ?? 'CASH', amountCents: fresh.remainingCents }],
  });
  expect(paid.statusCode, paid.body).toBe(200);
  return paid.json() as SaleDetail;
}

// ---------------------------------------------------------------------------
// Un día real de la barbería
// ---------------------------------------------------------------------------

let daySales: SaleDetail[];

beforeAll(async () => {
  const open = await api('POST', `/v1/branches/${B()}/cash`, { openingCashCents: 1_000_000 });
  expect(open.statusCode, open.body).toBe(201);

  daySales = [
    // Martín: corte con Juan, en efectivo.
    await sell({ customerId: customers[0]!.id, serviceName: 'Corte', barberId: juan }),
    // Otro cliente: corte + cera con Pedro, por transferencia, con propina.
    await sell({
      customerId: customers[1]!.id,
      serviceName: 'Corte',
      barberId: pedro,
      productName: 'Cera mate',
      tipCents: 200_000,
      method: 'TRANSFER',
    }),
    // Sin cliente: barba con Juan, en efectivo.
    await sell({ serviceName: 'Barba', barberId: juan }),
  ];

  // Un gasto del día.
  const category = await ctx.db.expenseCategory.findFirstOrThrow();
  await api('POST', '/v1/expenses', {
    branchId: B(),
    categoryId: category.id,
    occurredOn: TODAY,
    amountCents: 300_000,
    description: 'Café y insumos',
    method: 'CASH',
  });
});

describe('dashboard', () => {
  let dash: DashboardDto;

  beforeAll(async () => {
    const r = await api('GET', `/v1/dashboard?branchId=${B()}`);
    expect(r.statusCode, r.body).toBe(200);
    dash = r.json();
  });

  it('la plata del día es la suma de lo cobrado, abierta por medio de pago', () => {
    const total = daySales.reduce((a, s) => a + s.totalCents, 0);
    expect(dash.today.incomeCents).toBe(total);
    expect(dash.today.salesCount).toBe(3);
    expect(dash.today.averageTicketCents).toBe(Math.floor(total / 3));
    const byMethod = Object.fromEntries(dash.today.byMethod.map((m) => [m.method, m.amountCents]));
    expect(byMethod.CASH! + byMethod.TRANSFER!).toBe(total);
  });

  it('coincide con el cierre de caja del día (el criterio de la fase)', async () => {
    const current: { session: CashSessionDto | null } = (
      await api('GET', `/v1/branches/${B()}/cash/current`)
    ).json();
    expect(current.session).not.toBeNull();
    // El efectivo esperado del cierre y el del dashboard son el mismo número.
    const cash = current.session!.totals.find((t) => t.method === 'CASH')!;
    expect(dash.today.cashOnHandCents).toBe(cash.expectedCents);
  });

  it('la semana y el mes incluyen el día, y el mes pasado arranca en cero', () => {
    expect(dash.week.incomeCents).toBe(dash.today.incomeCents);
    expect(dash.month.incomeCents).toBe(dash.today.incomeCents);
    expect(dash.month.previousCents).toBe(0);
  });

  it('muestra los turnos de hoy y los que faltan atender', () => {
    expect(dash.date).toBe(TODAY);
    expect(dash.appointments.total).toBeGreaterThanOrEqual(0);
    expect(dash.appointments.next.every((a) => new Date(a.startsAt) >= new Date(`${TODAY}T00:00:00-03:00`))).toBe(
      true,
    );
  });

  it('la ocupación de un barbero nunca pasa del 100 % ni queda negativa', () => {
    for (const b of dash.barbers) {
      expect(b.occupancyBps).toBeGreaterThanOrEqual(0);
      expect(b.bookedMinutes).toBeLessThanOrEqual(b.availableMinutes || Number.MAX_SAFE_INTEGER);
    }
  });

  it('avisa del stock bajo', async () => {
    const key = { branchId_productId: { branchId: B(), productId: products['Cera mate']! } };
    const cera = await ctx.db.branchProduct.findUniqueOrThrow({ where: key });
    await ctx.db.branchProduct.update({ where: key, data: { minStock: cera.stockOnHand + 5 } });
    const alerts = ((await api('GET', `/v1/dashboard?branchId=${B()}`)).json() as DashboardDto).alerts;
    expect(alerts.lowStock.map((x) => x.name)).toContain('Cera mate');
    await ctx.db.branchProduct.update({ where: key, data: { minStock: cera.minStock } });
  });

  it('cuenta los clientes nuevos del mes', () => {
    // Los dos clientes atendidos hoy tuvieron su primera visita hoy.
    expect(dash.customers.newOnes + dash.customers.returning).toBe(2);
  });

  it('recepción no ve el dashboard', async () => {
    const reception = await inviteAndAccept(ctx, owner, {
      email: 'recepcion-reportes@estoicos.test',
      role: 'RECEPTION',
      branchIds: [B()],
    });
    expect((await api('GET', '/v1/dashboard', undefined, reception)).statusCode).toBe(403);
  });
});

describe('reporte por rango', () => {
  let report: ReportDto;

  beforeAll(async () => {
    const r = await api('GET', `/v1/reports?from=${TODAY}&to=${TODAY}&branchId=${B()}`);
    expect(r.statusCode, r.body).toBe(200);
    report = r.json();
  });

  it('lo cobrado coincide con las ventas del día', () => {
    expect(report.sales.count).toBe(3);
    expect(report.sales.incomeCents).toBe(daySales.reduce((a, s) => a + s.totalCents, 0));
    expect(report.sales.grossCents - report.sales.discountsCents).toBe(report.sales.incomeCents);
  });

  it('el día sin ventas aparece en cero en vez de faltar', async () => {
    const r: ReportDto = (
      await api('GET', `/v1/reports?from=2026-10-11&to=${TODAY}&branchId=${B()}`)
    ).json();
    expect(r.sales.byDay.map((d) => d.date)).toEqual(['2026-10-11', '2026-10-12', '2026-10-13']);
    expect(r.sales.byDay[0]!.amountCents).toBe(0);
    expect(r.sales.byDay[2]!.count).toBe(3);
  });

  it('ordena lo más vendido por plata', () => {
    expect(report.services.map((s) => s.name)).toContain('Corte');
    expect(report.services[0]!.name).toBe('Corte');
    expect(report.services[0]!.quantity).toBe(2);
    expect(report.products.map((p) => p.name)).toContain('Cera mate');
  });

  it('cada barbero con lo suyo: servicios, plata, comisión y propinas', () => {
    const j = report.barbers.find((b) => b.id === juan)!;
    const p = report.barbers.find((b) => b.id === pedro)!;
    expect(j.services).toBe(2);
    expect(p.services).toBe(1);
    // La propina no es facturación del barbero (queda para la casa, P22).
    expect(p.tipsCents).toBe(200_000);
    expect(p.revenueCents).toBe(PRECIO.corte + PRECIO.ceraMate);
    expect(j.commissionCents).toBeGreaterThan(0);
  });

  it('el resultado descuenta gastos, comisiones y el costo de los productos', () => {
    const { incomeCents, expensesCents, commissionsCents, productCostCents, resultCents } = report.result;
    expect(expensesCents).toBe(300_000);
    expect(resultCents).toBe(incomeCents - expensesCents - commissionsCents - productCostCents);
    expect(report.result.expensesByCategory.reduce((a, c) => a + c.amountCents, 0)).toBe(expensesCents);
  });

  it('cuenta los puntos emitidos', () => {
    // Un corte (25 puntos) y un corte con cera (25 + 12). La venta sin cliente no suma.
    const puntos = (cents: number) => cents / 100_000;
    expect(report.loyalty.pointsEarned).toBe(
      puntos(PRECIO.corte) + puntos(PRECIO.corte + PRECIO.ceraMate),
    );
    expect(report.loyalty.pointsRedeemed).toBe(0);
  });

  it('un rango al revés se rechaza', async () => {
    const r = await api('GET', `/v1/reports?from=${TODAY}&to=2026-10-01`);
    expect(r.statusCode).toBe(422);
  });

  it('el encargado no puede pedir los números de una sucursal que no es suya', async () => {
    const other = await ctx.db.branch.create({
      data: {
        organizationId: ctx.ids.organizationId,
        name: 'Sucursal Ajena',
        slug: 'ajena',
        timezone: 'America/Argentina/Buenos_Aires',
      },
    });
    const r = await api('GET', `/v1/reports?from=${TODAY}&to=${TODAY}&branchId=${other.id}`, undefined, manager);
    expect(r.statusCode).toBe(403);
  });
});

describe('export', () => {
  const url = (kind: string) => `/v1/reports/export/${kind}?from=${TODAY}&to=${TODAY}&branchId=${B()}`;

  it('solo el dueño puede bajar planillas', async () => {
    expect((await api('GET', url('ventas'), undefined, manager)).statusCode).toBe(403);
    expect((await api('GET', url('clientes'), undefined, manager)).statusCode).toBe(403);
  });

  it('la planilla de ventas se abre bien en Excel en español', async () => {
    const r = await api('GET', url('ventas'));
    expect(r.statusCode, r.body).toBe(200);
    expect(r.headers['content-type']).toContain('text/csv');
    expect(r.headers['content-disposition']).toContain('estoicos-ventas-2026-10-13-a-2026-10-13.csv');
    const csv = r.body;
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Fecha;Hora;Venta;Sucursal;Cliente;Detalle;Medios de pago');
    expect(csv).toContain('15000,00');
    // Una fila por venta, más el encabezado.
    expect(csv.trim().split('\r\n')).toHaveLength(4);
  });

  it('cada export queda auditado con qué se bajó y cuántas filas', async () => {
    await api('GET', url('clientes'));
    const audit = await ctx.db.auditLog.findFirst({
      where: { action: 'DATA_EXPORTED', entityId: 'clientes' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).not.toBeNull();
    expect((audit!.after as { rows: number }).rows).toBeGreaterThan(0);
    expect(audit!.actorUserId).toBe(ctx.ids.ownerId);
  });

  it('las demás planillas también salen', async () => {
    for (const kind of ['comisiones', 'egresos', 'puntos']) {
      const r = await api('GET', url(kind));
      expect(r.statusCode, `${kind}: ${r.body.slice(0, 200)}`).toBe(200);
      expect(r.body.split('\r\n').length).toBeGreaterThan(1);
    }
  });

  it('una planilla que no existe se rechaza', async () => {
    expect((await api('GET', url('sueldos'))).statusCode).toBe(422);
  });
});
