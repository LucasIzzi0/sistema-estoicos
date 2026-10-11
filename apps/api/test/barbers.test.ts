import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, createTestContext, inviteAndAccept, loginStaff, SERVICIOS_ACTIVOS, type TestContext } from './helpers';

let ctx: TestContext;
let owner: string;
beforeEach(async () => {
  ctx = await createTestContext();
  owner = await loginStaff(ctx, ADMIN_EMAIL);
});
afterEach(async () => {
  await ctx.close();
});

const createBarber = (payload: Record<string, unknown>, cookie = owner) =>
  ctx.inject({ method: 'POST', url: '/v1/barbers', cookie, payload });

describe('perfiles de barbero (sin acceso al sistema)', () => {
  it('se crea con todos los servicios activos y sus comisiones quedan auditadas', async () => {
    const res = await createBarber({
      displayName: 'Lucas',
      branchIds: [ctx.ids.branchId],
      serviceCommissionBps: 5000,
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      displayName: 'Lucas',
      serviceCommissionBps: 5000,
      // Las propinas quedan para la casa (P22): por defecto 0 %.
      tipCommissionBps: 0,
    });
    expect(res.json().services).toHaveLength(SERVICIOS_ACTIVOS);
    expect(
      await ctx.db.auditLog.count({ where: { action: 'COMMISSION_RATE_CHANGED', entityId: res.json().id } }),
    ).toBe(1);
  });

  it('un barbero no es un usuario: no existe membresía asociada', async () => {
    const res = await createBarber({ displayName: 'Lucas', branchIds: [ctx.ids.branchId] });
    const row = await ctx.db.barber.findUniqueOrThrow({ where: { id: res.json().id } });
    expect(row.membershipId).toBeNull();
  });

  it('cambiar la comisión queda auditado', async () => {
    const [juan] = ctx.ids.barberIds;
    await ctx.inject({
      method: 'PATCH',
      url: `/v1/barbers/${juan}`,
      cookie: owner,
      payload: { serviceCommissionBps: 5500 },
    });
    const audit = await ctx.db.auditLog.findFirstOrThrow({
      where: { action: 'COMMISSION_RATE_CHANGED', entityId: juan },
    });
    expect(audit.before).toEqual({ serviceCommissionBps: 5000 });
    expect(audit.after).toEqual({ serviceCommissionBps: 5500 });
  });
});

describe('horario semanal', () => {
  it('acepta turno partido y rechaza tramos que se pisan', async () => {
    const [juan] = ctx.ids.barberIds;
    const ok = await ctx.inject({
      method: 'PUT',
      url: `/v1/barbers/${juan}/schedule`,
      cookie: owner,
      payload: {
        branchId: ctx.ids.branchId,
        intervals: [
          { weekday: 2, startMinute: 600, endMinute: 840 },
          { weekday: 2, startMinute: 900, endMinute: 1200 },
        ],
      },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().schedules).toHaveLength(2);

    const bad = await ctx.inject({
      method: 'PUT',
      url: `/v1/barbers/${juan}/schedule`,
      cookie: owner,
      payload: {
        branchId: ctx.ids.branchId,
        intervals: [
          { weekday: 2, startMinute: 600, endMinute: 900 },
          { weekday: 2, startMinute: 840, endMinute: 1200 },
        ],
      },
    });
    expect(bad.statusCode).toBe(422);
    expect(bad.json().error.message).toMatch(/Martes.*se pisan/);
  });

  it('no puede estar en dos sucursales a la misma hora', async () => {
    const [juan] = ctx.ids.barberIds;
    const norte = await ctx.db.branch.create({
      data: { organizationId: ctx.ids.organizationId, name: 'Norte', slug: 'norte' },
    });
    await ctx.inject({
      method: 'PATCH',
      url: `/v1/barbers/${juan}`,
      cookie: owner,
      payload: { branchIds: [ctx.ids.branchId, norte.id] },
    });
    // En la principal trabaja martes a sábado 10–20 (seed): el martes 18–21 en Norte se pisa.
    const clash = await ctx.inject({
      method: 'PUT',
      url: `/v1/barbers/${juan}/schedule`,
      cookie: owner,
      payload: { branchId: norte.id, intervals: [{ weekday: 2, startMinute: 1080, endMinute: 1260 }] },
    });
    expect(clash.statusCode).toBe(422);
    expect(clash.json().error.message).toMatch(/Sucursal Principal/);
    // El lunes está libre.
    const monday = await ctx.inject({
      method: 'PUT',
      url: `/v1/barbers/${juan}/schedule`,
      cookie: owner,
      payload: { branchId: norte.id, intervals: [{ weekday: 1, startMinute: 600, endMinute: 1200 }] },
    });
    expect(monday.statusCode).toBe(200);
  });

  it('dejar de trabajar en una sucursal borra su horario ahí', async () => {
    const [juan] = ctx.ids.barberIds;
    const norte = await ctx.db.branch.create({
      data: { organizationId: ctx.ids.organizationId, name: 'Norte', slug: 'norte' },
    });
    const res = await ctx.inject({
      method: 'PATCH',
      url: `/v1/barbers/${juan}`,
      cookie: owner,
      payload: { branchIds: [norte.id] },
    });
    expect(res.json().schedules).toHaveLength(0);
  });
});

describe('bloqueos y feriados en hora local', () => {
  it('un día completo va de 00:00 a 00:00 de Buenos Aires', async () => {
    const [juan] = ctx.ids.barberIds;
    const res = await ctx.inject({
      method: 'POST',
      url: `/v1/barbers/${juan}/time-offs`,
      cookie: owner,
      payload: { branchId: null, type: 'VACATION', date: '2099-10-12', endDate: '2099-10-14' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().timeOffs[0]).toMatchObject({
      startsAt: '2099-10-12T03:00:00.000Z',
      endsAt: '2099-10-15T03:00:00.000Z',
    });
  });

  it('un trámite de 15 a 17 queda en esas horas locales', async () => {
    const [juan] = ctx.ids.barberIds;
    const res = await ctx.inject({
      method: 'POST',
      url: `/v1/barbers/${juan}/time-offs`,
      cookie: owner,
      payload: {
        branchId: ctx.ids.branchId,
        type: 'PERSONAL',
        date: '2099-10-12',
        startTime: '15:00',
        endTime: '17:00',
      },
    });
    expect(res.json().timeOffs[0]).toMatchObject({
      startsAt: '2099-10-12T18:00:00.000Z',
      endsAt: '2099-10-12T20:00:00.000Z',
    });
    const del = await ctx.inject({
      method: 'DELETE',
      url: `/v1/barbers/${juan}/time-offs/${res.json().timeOffs[0].id}`,
      cookie: owner,
    });
    expect(del.json().timeOffs).toHaveLength(0);
  });

  it('feriado de la sucursal', async () => {
    const res = await ctx.inject({
      method: 'POST',
      url: `/v1/branches/${ctx.ids.branchId}/closures`,
      cookie: owner,
      payload: { date: '2099-07-09', reason: 'Día de la Independencia' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual([
      expect.objectContaining({ reason: 'Día de la Independencia', startsAt: '2099-07-09T03:00:00.000Z' }),
    ]);
  });
});

describe('alcance del encargado', () => {
  it('gestiona barberos de su sucursal, no los que también trabajan en otra', async () => {
    const norte = await ctx.db.branch.create({
      data: { organizationId: ctx.ids.organizationId, name: 'Norte', slug: 'norte' },
    });
    const manager = await inviteAndAccept(ctx, owner, {
      email: 'enc@estoicos.test',
      role: 'ADMIN',
      branchIds: [ctx.ids.branchId],
    });
    const [juan, pedro] = ctx.ids.barberIds;
    await ctx.inject({
      method: 'PATCH',
      url: `/v1/barbers/${pedro}`,
      cookie: owner,
      payload: { branchIds: [ctx.ids.branchId, norte.id] },
    });

    expect(
      (
        await ctx.inject({
          method: 'PATCH',
          url: `/v1/barbers/${juan}`,
          cookie: manager,
          payload: { color: '#112233' },
        })
      ).statusCode,
    ).toBe(200);
    const blocked = await ctx.inject({
      method: 'PATCH',
      url: `/v1/barbers/${pedro}`,
      cookie: manager,
      payload: { color: '#112233' },
    });
    expect(blocked.statusCode).toBe(403);
    expect((await createBarber({ displayName: 'X', branchIds: [norte.id] }, manager)).statusCode).toBe(403);
  });
});
