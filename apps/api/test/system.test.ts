import { evaluateQueues, raiseAlert, recordHeartbeat, runHousekeeping } from '@estoicos/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, createTestContext, inviteAndAccept, loginStaff, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.close();
});

const health = async (cookie: string) =>
  (await ctx.inject({ method: 'GET', url: '/v1/system/health', cookie })).json();

describe('salud del sistema', () => {
  it('sin latido reciente el worker figura caído, se abre una alerta crítica y se cierra sola al volver', async () => {
    const owner = await loginStaff(ctx, ADMIN_EMAIL);
    expect((await health(owner)).worker.status).toBe('unknown');

    await recordHeartbeat(ctx.db, { instanceId: 'w1', startedAt: ctx.clock.now, now: ctx.clock.now });
    expect((await health(owner)).worker.status).toBe('ok');

    ctx.clock.advanceMinutes(5);
    const down = await health(owner);
    expect(down.worker.status).toBe('down');
    expect(down.alerts).toEqual([expect.objectContaining({ kind: 'WORKER_DOWN', severity: 'CRITICAL' })]);

    // Consultar de nuevo no duplica la alerta: suma avistajes.
    const again = await health(owner);
    expect(again.alerts).toHaveLength(1);
    expect(again.alerts[0].occurrences).toBe(2);

    await recordHeartbeat(ctx.db, { instanceId: 'w1', startedAt: ctx.clock.now, now: ctx.clock.now });
    const back = await health(owner);
    expect(back.worker.status).toBe('ok');
    expect(back.alerts).toHaveLength(0);
  });

  it('colas atrasadas o trabadas abren alertas y se resuelven cuando se normalizan', async () => {
    const thresholds = { stuckMinutes: 10, failuresPer15Min: 5 };
    const base = { name: 'system', waiting: 3, active: 1, failed: 0, recentFailures: 0 };
    await evaluateQueues(
      ctx.db,
      [{ ...base, oldestWaitingSeconds: 900, longestActiveSeconds: 1200 }],
      thresholds,
      ctx.clock.now,
    );
    const open = await ctx.db.systemAlert.findMany({ where: { resolvedAt: null } });
    expect(open.map((a) => a.kind).sort()).toEqual(['JOB_STUCK', 'QUEUE_BACKLOG']);

    await evaluateQueues(
      ctx.db,
      [{ ...base, oldestWaitingSeconds: 5, longestActiveSeconds: 2 }],
      thresholds,
      ctx.clock.now,
    );
    expect(await ctx.db.systemAlert.count({ where: { resolvedAt: null } })).toBe(0);
  });

  it('el admin puede marcar una alerta como vista; recepción no ve el estado del sistema', async () => {
    await raiseAlert(
      ctx.db,
      { kind: 'MP_SYNC_FAILING', severity: 'WARNING', dedupeKey: 'mp-sync', message: 'prueba' },
      ctx.clock.now,
    );
    const owner = await loginStaff(ctx, ADMIN_EMAIL);
    const alertId = (await health(owner)).alerts[0].id;
    const ack = await ctx.inject({ method: 'POST', url: `/v1/system/alerts/${alertId}/ack`, cookie: owner });
    expect(ack.statusCode).toBe(200);
    expect((await health(owner)).alerts[0].acknowledgedAt).not.toBeNull();

    const reception = await inviteAndAccept(ctx, owner, {
      email: 'rec@estoicos.test',
      role: 'RECEPTION',
      branchIds: [ctx.ids.branchId],
    });
    expect(
      (await ctx.inject({ method: 'GET', url: '/v1/system/health', cookie: reception })).statusCode,
    ).toBe(403);
  });

  it('la limpieza borra códigos y sesiones vencidas hace más de 7 días', async () => {
    await loginStaff(ctx, ADMIN_EMAIL);
    await ctx.inject({
      method: 'POST',
      url: '/v1/auth/customer/request-code',
      payload: { email: 'a@example.com' },
    });
    const later = new Date(ctx.clock.now.getTime() + 20 * 24 * 60 * 60_000);
    const result = await runHousekeeping(ctx.db, later);
    expect(result.authCodes).toBe(1);
    expect(result.sessions).toBe(1);
  });

  it('health/deep informa base, Redis y worker', async () => {
    const response = await ctx.app.inject({ method: 'GET', url: '/health/deep' });
    expect(response.json()).toMatchObject({
      database: true,
      redis: true,
      worker: 'unknown',
      status: 'degraded',
    });
  });
});
