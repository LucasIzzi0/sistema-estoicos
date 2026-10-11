import { buildSignedManifest, signManifest } from '@estoicos/integrations';
import type {
  MpAccountDto,
  MpInboxItem,
  MpOrderDto,
  MpTerminalDto,
  RefundDto,
  SaleDetail,
} from '@estoicos/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, createTestContext, inviteAndAccept, loginStaff, SUCURSAL, type TestContext } from './helpers';

/**
 * Fase 5: Mercado Pago. Todo corre contra el simulador (`FakeMercadoPago`), que reproduce el
 * comportamiento documentado: una orden por terminal, estados, expiración y reintegros.
 */
const NOW = new Date('2026-10-13T10:30:00-03:00');
const WEBHOOK_SECRET = 'clave-de-webhooks-de-prueba';
const TOKEN = 'TEST-1234567890-abcdefghijklmnopqrstuvwxyz';

let ctx: TestContext;
let owner: string;
let manager: string;
let juan: string;
const services: Record<string, string> = {};
let customerId: string;
let terminalPdv: MpTerminalDto;

beforeAll(async () => {
  ctx = await createTestContext();
  ctx.clock.now = NOW;
  owner = await loginStaff(ctx, ADMIN_EMAIL);
  manager = await inviteAndAccept(ctx, owner, {
    email: 'encargado@estoicos.test',
    role: 'ADMIN',
    branchIds: [ctx.ids.branchId],
  });
  juan = ctx.ids.barberIds[0]!;
  for (const s of await ctx.db.service.findMany()) services[s.name] = s.id;
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
  cookie: string | undefined = owner,
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

/** Webhook firmado como lo manda Mercado Pago. */
function webhook(input: {
  topic: 'order' | 'payment';
  dataId: string;
  userId?: string;
  version?: number;
  notificationId?: string;
  secret?: string;
  requestId?: string;
  badSignature?: boolean;
  noSignature?: boolean;
}) {
  const ts = '1760000000';
  const requestId = input.requestId ?? `req-${input.dataId}`;
  const manifest = buildSignedManifest({ dataId: input.dataId, requestId, ts });
  const v1 = signManifest(manifest, input.secret ?? WEBHOOK_SECRET);
  const headers: Record<string, string> = { 'x-request-id': requestId };
  if (!input.noSignature) headers['x-signature'] = `ts=${ts},v1=${input.badSignature ? 'f'.repeat(64) : v1}`;
  return ctx.inject({
    method: 'POST',
    url: `/webhooks/mercadopago?data.id=${input.dataId}&type=${input.topic}`,
    headers,
    payload: {
      id: input.notificationId ?? `notif-${input.dataId}`,
      type: input.topic,
      action: `${input.topic}.updated`,
      user_id: input.userId ?? '1234567890',
      version: input.version,
      data: { id: input.dataId },
    },
  });
}

/** Venta abierta con un corte, lista para cobrar. */
async function openSale(): Promise<SaleDetail> {
  const sale: SaleDetail = (await api('POST', `/v1/branches/${B()}/sales`, { customerId })).json();
  const withItem = await api('POST', `/v1/sales/${sale.id}/items`, {
    type: 'SERVICE',
    serviceId: services.Corte,
    barberId: juan,
  });
  expect(withItem.statusCode, withItem.body).toBe(200);
  return withItem.json();
}

/** Deja la terminal libre: cancela en la base cualquier cobro que haya quedado esperando. */
async function freeTerminal() {
  const pending = await ctx.db.mpOrder.findMany({ where: { status: 'PENDING' } });
  for (const order of pending) {
    await ctx.db.mpOrder.update({ where: { id: order.id }, data: { status: 'CANCELED' } });
    await ctx.db.payment.updateMany({ where: { id: order.paymentId }, data: { status: 'CANCELED' } });
    if (order.externalId) {
      const fake = ctx.mp.orders.get(order.externalId);
      if (fake && ['created', 'at_terminal'].includes(fake.status)) fake.status = 'canceled';
    }
  }
}

/** La pantalla consulta el estado cada 2 s: con el reloj fijo hay que avanzarlo para que pregunte. */
async function pollOrder(orderId: string) {
  ctx.clock.advanceMinutes(1);
  const r = await api('GET', `/v1/point-orders/${orderId}`);
  ctx.clock.now = NOW;
  return r;
}

async function openCash() {
  const current = await api('GET', `/v1/branches/${B()}/cash/current`);
  if (!current.json().session) {
    const r = await api('POST', `/v1/branches/${B()}/cash`, { openingCashCents: 1_000_000 });
    expect(r.statusCode, r.body).toBe(201);
  }
}

describe('vinculación de la cuenta', () => {
  it('guarda el token cifrado y nunca lo devuelve', async () => {
    const r = await api('POST', '/v1/mercadopago/account', {
      label: 'Cuenta de la barbería',
      accessToken: TOKEN,
      webhookSecret: WEBHOOK_SECRET,
    });
    expect(r.statusCode, r.body).toBe(201);
    const account: MpAccountDto = r.json();
    expect(account).toMatchObject({ status: 'ACTIVE', liveMode: false, hasWebhookSecret: true });
    expect(r.body).not.toContain(TOKEN);
    expect(r.body).not.toContain(WEBHOOK_SECRET);

    const row = await ctx.db.mpAccount.findFirstOrThrow();
    expect(row.accessTokenEnc).not.toContain(TOKEN);
    expect(row.accessTokenEnc.startsWith('enc1.')).toBe(true);
    expect(await ctx.db.auditLog.count({ where: { action: 'MP_ACCOUNT_CONNECTED' } })).toBe(1);
  });

  it('solo el dueño vincula; el encargado puede mirar', async () => {
    expect((await api('POST', '/v1/mercadopago/account', { accessToken: TOKEN }, manager)).statusCode).toBe(
      403,
    );
    expect((await api('GET', '/v1/mercadopago/account', undefined, manager)).statusCode).toBe(200);
  });

  it('un token que Mercado Pago rechaza no se guarda', async () => {
    const before = await ctx.db.mpAccount.count();
    ctx.mp.failNext = Object.assign(new Error('unauthorized'), {
      name: 'MercadoPagoError',
      status: 401,
      invalidToken: true,
      terminalBusy: false,
    }) as never;
    const r = await api('POST', '/v1/mercadopago/account', { accessToken: 'TEST-token-que-no-sirve-123456' });
    expect([422, 503]).toContain(r.statusCode);
    expect(await ctx.db.mpAccount.count()).toBe(before);
  });
});

describe('terminales', () => {
  it('se sincronizan desde Mercado Pago y se asignan a una sucursal', async () => {
    const r = await api('POST', '/v1/mercadopago/terminals/sync');
    expect(r.statusCode, r.body).toBe(200);
    const terminals: MpTerminalDto[] = r.json();
    expect(terminals.map((t) => t.externalId).sort()).toEqual([
      'NEWLAND_N950__SBX0000001',
      'NEWLAND_N950__SBX0000002',
    ]);
    terminalPdv = terminals.find((t) => t.operatingMode === 'PDV')!;
    const assigned = await api('PATCH', `/v1/mercadopago/terminals/${terminalPdv.id}`, {
      branchId: B(),
      label: 'Mostrador',
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect((assigned.json() as MpTerminalDto[]).find((t) => t.id === terminalPdv.id)).toMatchObject({
      label: 'Mostrador',
      branchName: SUCURSAL,
    });
    expect(await ctx.db.auditLog.count({ where: { action: 'MP_TERMINAL_ASSIGNED' } })).toBe(1);
  });

  it('pasar una terminal a modo PDV queda guardado', async () => {
    const standalone = (await api('GET', '/v1/mercadopago/terminals')).json() as MpTerminalDto[];
    const otra = standalone.find((t) => t.operatingMode === 'STANDALONE')!;
    const r = await api('POST', `/v1/mercadopago/terminals/${otra.id}/mode`, { mode: 'PDV' });
    expect(r.statusCode, r.body).toBe(200);
    expect((r.json() as MpTerminalDto[]).find((t) => t.id === otra.id)!.operatingMode).toBe('PDV');
    await api('POST', `/v1/mercadopago/terminals/${otra.id}/mode`, { mode: 'STANDALONE' });
  });
});

describe('cobro con Point', () => {
  it('manda el cobro a la terminal y la venta sigue abierta hasta que Mercado Pago confirma', async () => {
    await openCash();
    const sale = await openSale();
    const r = await api('POST', `/v1/sales/${sale.id}/point-orders`, {
      terminalId: terminalPdv.id,
      amountCents: sale.totalCents,
    });
    expect(r.statusCode, r.body).toBe(201);
    const order: MpOrderDto = r.json();
    expect(order).toMatchObject({ status: 'PENDING', mpStatus: 'created', cancelable: true });

    const stored = await ctx.db.mpOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(stored.externalReference).toMatch(/^sale_[a-f0-9]{32}_1$/);
    const payment = await ctx.db.payment.findUniqueOrThrow({ where: { id: stored.paymentId } });
    expect(payment).toMatchObject({ status: 'PENDING', method: 'MP_POINT' });
    expect((await ctx.db.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('OPEN');
  });

  it('la misma terminal no acepta dos cobros a la vez', async () => {
    const otra = await openSale();
    const r = await api('POST', `/v1/sales/${otra.id}/point-orders`, {
      terminalId: terminalPdv.id,
      amountCents: otra.totalCents,
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('TERMINAL_BUSY');
  });

  it('el webhook de la orden aprueba el cobro y cierra la venta (comisiones y turno incluidos)', async () => {
    const order = await ctx.db.mpOrder.findFirstOrThrow({ where: { status: 'PENDING' } });
    ctx.mp.atTerminal(order.externalId!);
    ctx.mp.payOrder(order.externalId!);

    const received = await webhook({ topic: 'order', dataId: order.externalId!, version: 3 });
    expect(received.statusCode, received.body).toBe(200);
    const event = await ctx.db.webhookEvent.findFirstOrThrow({ where: { resourceId: order.externalId! } });
    expect(event.eventKey).toBe(`order:${order.externalId}:v3`);

    // El trabajo real lo hace el worker.
    const { processWebhookEvent } = await import('@estoicos/core');
    expect(await processWebhookEvent(ctx.deps, event.id)).toBe('cobro aprobado');

    const sale = await ctx.db.sale.findUniqueOrThrow({ where: { id: order.saleId } });
    expect(sale.status).toBe('PAID');
    expect(Number(sale.paidCents)).toBe(Number(sale.totalCents));
    expect(await ctx.db.commissionEntry.count({ where: { saleId: sale.id } })).toBe(1);
    expect((await ctx.db.mpOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('APPROVED');
  });

  it('el mismo webhook tres veces deja un solo cobro y una sola comisión', async () => {
    const order = await ctx.db.mpOrder.findFirstOrThrow({ where: { status: 'APPROVED' } });
    const { processWebhookEvent } = await import('@estoicos/core');
    for (let i = 0; i < 3; i += 1) {
      const r = await webhook({ topic: 'order', dataId: order.externalId!, version: 3 });
      expect(r.statusCode).toBe(200);
      const event = await ctx.db.webhookEvent.findFirstOrThrow({
        where: { eventKey: `order:${order.externalId}:v3` },
      });
      await processWebhookEvent(ctx.deps, event.id);
    }
    expect(await ctx.db.webhookEvent.count({ where: { eventKey: `order:${order.externalId}:v3` } })).toBe(1);
    expect(await ctx.db.payment.count({ where: { saleId: order.saleId, status: 'APPROVED' } })).toBe(1);
    expect(await ctx.db.commissionEntry.count({ where: { saleId: order.saleId } })).toBe(1);
  });

  it('un cobro rechazado deja la venta abierta y se puede reintentar', async () => {
    await freeTerminal();
    const sale = await openSale();
    const first = await api('POST', `/v1/sales/${sale.id}/point-orders`, {
      terminalId: terminalPdv.id,
      amountCents: sale.totalCents,
    });
    const order = await ctx.db.mpOrder.findUniqueOrThrow({ where: { id: first.json().id } });
    ctx.mp.rejectOrder(order.externalId!);

    const status = await pollOrder(order.id);
    expect(status.json()).toMatchObject({ status: 'REJECTED', mpStatusDetail: 'insufficient_amount' });
    expect((await ctx.db.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).status).toBe(
      'REJECTED',
    );
    expect((await ctx.db.sale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe('OPEN');

    // La terminal quedó libre: el segundo intento lleva otra referencia.
    const retry = await api('POST', `/v1/sales/${sale.id}/point-orders`, {
      terminalId: terminalPdv.id,
      amountCents: sale.totalCents,
    });
    expect(retry.statusCode, retry.body).toBe(201);
    const second = await ctx.db.mpOrder.findUniqueOrThrow({ where: { id: retry.json().id } });
    expect(second.externalReference).toMatch(/_2$/);
    await api('POST', `/v1/point-orders/${second.id}/cancel`);
  });

  it('se cancela desde el sistema solo hasta que la terminal lo toma', async () => {
    await freeTerminal();
    const sale = await openSale();
    const created = await api('POST', `/v1/sales/${sale.id}/point-orders`, {
      terminalId: terminalPdv.id,
      amountCents: sale.totalCents,
    });
    const order = await ctx.db.mpOrder.findUniqueOrThrow({ where: { id: created.json().id } });
    ctx.mp.atTerminal(order.externalId!);

    const late = await api('POST', `/v1/point-orders/${order.id}/cancel`);
    expect(late.statusCode).toBe(409);
    expect(late.json().error.message).toContain('terminal');

    // Vuelve a "created" (el cliente salió de la pantalla) y ahí sí se cancela.
    const fake = ctx.mp.orders.get(order.externalId!)!;
    fake.status = 'created';
    const ok = await api('POST', `/v1/point-orders/${order.id}/cancel`);
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('CANCELED');
    expect((await ctx.db.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).status).toBe(
      'CANCELED',
    );
  });

  it('una orden que vence libera la terminal', async () => {
    await freeTerminal();
    const sale = await openSale();
    const created = await api('POST', `/v1/sales/${sale.id}/point-orders`, {
      terminalId: terminalPdv.id,
      amountCents: sale.totalCents,
    });
    const order = await ctx.db.mpOrder.findUniqueOrThrow({ where: { id: created.json().id } });
    ctx.clock.advanceMinutes(11);
    const status = await api('GET', `/v1/point-orders/${order.id}`);
    expect(status.statusCode, status.body).toBe(200);
    expect(status.json().status).toBe('EXPIRED');
    expect((await ctx.db.payment.findUniqueOrThrow({ where: { id: order.paymentId } })).status).toBe(
      'EXPIRED',
    );
    ctx.clock.now = NOW;
  });
});

describe('seguridad del webhook', () => {
  it('sin firma, con firma alterada o con otra clave: 401 y no se registra nada', async () => {
    const before = await ctx.db.webhookEvent.count();
    for (const options of [
      { noSignature: true },
      { badSignature: true },
      { secret: 'otra-clave-distinta' },
    ] as const) {
      const r = await webhook({ topic: 'payment', dataId: '123456789', ...options });
      expect(r.statusCode, JSON.stringify(options)).toBe(401);
    }
    expect(await ctx.db.webhookEvent.count()).toBe(before);
    const alert = await ctx.db.systemAlert.findFirst({ where: { kind: 'WEBHOOK_SIGNATURE_INVALID' } });
    expect(alert?.occurrences).toBeGreaterThanOrEqual(3);
  });

  it('un webhook de una cuenta desconocida se responde 200 y se ignora', async () => {
    const before = await ctx.db.webhookEvent.count();
    const r = await webhook({ topic: 'payment', dataId: '999', userId: '55555' });
    expect(r.statusCode).toBe(200);
    expect(await ctx.db.webhookEvent.count()).toBe(before);
  });

  it('el mismo aviso de pago repetido se guarda una sola vez', async () => {
    const payment = ctx.mp.pushPayment({ amount: 5000, description: 'Transferencia suelta' });
    for (let i = 0; i < 3; i += 1) {
      const r = await webhook({ topic: 'payment', dataId: String(payment.id), notificationId: 'notif-abc' });
      expect(r.statusCode).toBe(200);
    }
    expect(await ctx.db.webhookEvent.count({ where: { eventKey: 'payment:notif-abc' } })).toBe(1);
  });
});

describe('conciliación', () => {
  it('un pago suelto va a la bandeja con sugerencias, y asignarlo cobra la venta', async () => {
    // El reloj de los tests va adelantado; la base fecha con la hora real. Se corre el corte
    // de conciliación hacia atrás para que los pagos de prueba entren igual.
    await ctx.db.mpAccount.updateMany({ data: { reconcileFrom: new Date('2020-01-01') } });
    const sale = await openSale();
    // La venta la fecha la base con la hora real, así que el pago va con esa misma hora.
    const mpPayment = ctx.mp.pushPayment({
      amount: sale.totalCents / 100,
      description: 'Cobro fuera del sistema',
      createdAt: new Date(),
    });
    const { processWebhookEvent } = await import('@estoicos/core');
    await webhook({ topic: 'payment', dataId: String(mpPayment.id), notificationId: `n-${mpPayment.id}` });
    const event = await ctx.db.webhookEvent.findFirstOrThrow({
      where: { eventKey: `payment:n-${mpPayment.id}` },
    });
    await processWebhookEvent(ctx.deps, event.id);

    const inbox: MpInboxItem[] = (await api('GET', '/v1/mercadopago/payments?status=UNASSIGNED')).json();
    const item = inbox.find((x) => x.externalId === String(mpPayment.id))!;
    expect(item).toBeDefined();
    expect(item.suggestions.some((s) => s.id === sale.id && s.reasons.includes('mismo monto'))).toBe(true);

    const assigned = await api('POST', `/v1/mercadopago/payments/${item.id}/assign`, {
      target: 'SALE',
      saleId: sale.id,
    });
    expect(assigned.statusCode, assigned.body).toBe(200);
    expect(assigned.json().reconciliationStatus).toBe('MANUALLY_ASSIGNED');
    const paid = await ctx.db.sale.findUniqueOrThrow({ where: { id: sale.id } });
    expect(paid.status).toBe('PAID');
    expect(await ctx.db.auditLog.count({ where: { action: 'MP_PAYMENT_RECONCILED' } })).toBe(1);
  });

  it('un pago rechazado no entra a la bandeja', async () => {
    const rejected = ctx.mp.pushPayment({ amount: 1000, status: 'rejected', statusDetail: 'cc_rejected' });
    const { syncPaymentById } = await import('@estoicos/core');
    await syncPaymentById(ctx.deps, '1234567890', String(rejected.id), 'SYNC_JOB');
    const row = await ctx.db.mpPayment.findUniqueOrThrow({ where: { externalId: String(rejected.id) } });
    expect(row.reconciliationStatus).toBe('NOT_APPLICABLE');
  });

  it('el cobro con Point queda vinculado solo (no pide decisión)', async () => {
    const order = await ctx.db.mpOrder.findFirstOrThrow({ where: { status: 'APPROVED' } });
    const row = await ctx.db.mpPayment.findFirst({ where: { mpOrderRef: order.externalId } });
    expect(row?.reconciliationStatus).toBe('AUTO_MATCHED');
  });

  it('se puede marcar como otro ingreso o ignorar con motivo', async () => {
    const extra = ctx.mp.pushPayment({ amount: 3000, description: 'Venta de un mueble viejo' });
    const { syncPaymentById } = await import('@estoicos/core');
    await syncPaymentById(ctx.deps, '1234567890', String(extra.id), 'SYNC_JOB');
    const row = await ctx.db.mpPayment.findUniqueOrThrow({ where: { externalId: String(extra.id) } });
    const r = await api('POST', `/v1/mercadopago/payments/${row.id}/assign`, {
      target: 'OTHER_INCOME',
      description: 'Venta de un mueble',
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().reconciliationStatus).toBe('OTHER_INCOME');
  });

  it('la sincronización periódica trae los pagos de la cuenta', async () => {
    ctx.mp.pushPayment({ amount: 7777, description: 'Pago que llegó por sincronización' });
    const { syncAccountPayments } = await import('@estoicos/core');
    const account = await ctx.db.mpAccount.findFirstOrThrow();
    const result = await syncAccountPayments(ctx.deps, account.id);
    expect(result.fetched).toBeGreaterThan(0);
    expect(await ctx.db.mpPayment.count({ where: { amountCents: 777_700 } })).toBe(1);
    expect(
      (await ctx.db.mpAccount.findUniqueOrThrow({ where: { id: account.id } })).paymentsSyncedUntil,
    ).not.toBeNull();
  });
});

describe('reintegros', () => {
  it('solo el dueño puede devolver plata', async () => {
    const payment = await ctx.db.payment.findFirstOrThrow({
      where: { status: 'APPROVED', method: 'MP_POINT' },
    });
    const r = await api('POST', `/v1/payments/${payment.id}/refunds`, { reason: 'Prueba' }, manager);
    expect(r.statusCode).toBe(403);
  });

  it('devuelve al medio original y lo pide a Mercado Pago', async () => {
    const payment = await ctx.db.payment.findFirstOrThrow({
      where: { status: 'APPROVED', method: 'MP_POINT' },
      include: { mpPayment: true },
    });
    const r = await api('POST', `/v1/payments/${payment.id}/refunds`, {
      reason: 'El cliente no quedó conforme',
      destination: 'ORIGINAL_METHOD',
    });
    expect(r.statusCode, r.body).toBe(201);
    const refund: RefundDto = r.json();
    expect(refund).toMatchObject({ status: 'APPROVED', destination: 'ORIGINAL_METHOD' });
    expect((await ctx.db.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('REFUNDED');
    expect(await ctx.db.auditLog.count({ where: { action: 'PAYMENT_REFUNDED' } })).toBe(1);
  });

  it('devolver a saldo a favor no depende de Mercado Pago', async () => {
    await openCash();
    const sale = await openSale();
    const paid = await api('POST', `/v1/sales/${sale.id}/pay`, {
      payments: [{ method: 'CASH', amountCents: sale.totalCents }],
    });
    expect(paid.statusCode, paid.body).toBe(200);
    const payment = await ctx.db.payment.findFirstOrThrow({ where: { saleId: sale.id, method: 'CASH' } });
    const r = await api('POST', `/v1/payments/${payment.id}/refunds`, {
      reason: 'Se lo dejamos como crédito',
      destination: 'CUSTOMER_CREDIT',
    });
    expect(r.statusCode, r.body).toBe(201);
    const credit = await ctx.db.customerCreditEntry.findFirstOrThrow({
      where: { customerId, type: 'REFUND_TO_CREDIT' },
    });
    expect(Number(credit.amountCents)).toBe(sale.totalCents);
  });

  it('no se puede devolver más de lo cobrado', async () => {
    const payment = await ctx.db.payment.findFirstOrThrow({ where: { status: 'REFUNDED' } });
    const r = await api('POST', `/v1/payments/${payment.id}/refunds`, { reason: 'De nuevo' });
    expect(r.statusCode).toBe(409);
  });
});
