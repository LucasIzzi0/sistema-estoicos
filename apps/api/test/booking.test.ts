import { findDueNotifications, isSlotConflict, sendNotification } from '@estoicos/core';
import type {
  Agenda,
  AppointmentDetail,
  Availability,
  MyAppointment,
  MyAppointments,
  PublicBranch,
} from '@estoicos/shared';
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
 * Fase 3: disponibilidad, reservas online, agenda del panel y notificaciones.
 * Reloj fijo: lunes 12/10/2026 12:00 en Buenos Aires. El seed tiene a Juan y Pedro de martes
 * a sábado de 10 a 20, así que el martes 13 es el primer día con horarios.
 */
const MONDAY_NOON = new Date('2026-10-12T12:00:00-03:00');
const TUESDAY = '2026-10-13';

let ctx: TestContext;
let owner: string;
let juan: string;
let pedro: string;
const services: Record<string, string> = {};
let customerIds: string[];

beforeAll(async () => {
  ctx = await createTestContext();
  [juan, pedro] = ctx.ids.barberIds as [string, string];
  for (const s of await ctx.db.service.findMany()) services[s.name] = s.id;
  customerIds = (await ctx.db.customer.findMany({ orderBy: { createdAt: 'asc' } })).map((c) => c.id);
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  ctx.clock.now = MONDAY_NOON;
  await ctx.db.notification.deleteMany({ where: { appointmentId: { not: null } } });
  await ctx.db.$executeRawUnsafe('TRUNCATE appointment_events, appointment_services, appointments CASCADE');
  await ctx.db.barberTimeOff.deleteMany();
  await ctx.db.branchClosure.deleteMany();
  await ctx.redis.flushdb();
  // La sesión se valida con el reloj fijo: se entra de nuevo "en" ese momento.
  owner = await loginStaff(ctx, ADMIN_EMAIL);
});

let emailCounter = 0;
/** Cliente nuevo con sesión y perfil completo. */
async function newCustomer(opts: { completeProfile?: boolean } = {}) {
  const email = `cliente${++emailCounter}@example.com`;
  await ctx.inject({ method: 'POST', url: '/v1/auth/customer/request-code', payload: { email } });
  const cookie = sessionCookie(
    await ctx.inject({
      method: 'POST',
      url: '/v1/auth/customer/verify-code',
      payload: { email, code: codeFromEmail(ctx.mailer) },
    }),
  );
  if (opts.completeProfile !== false) {
    const r = await ctx.inject({
      method: 'PUT',
      url: '/v1/me/customer/profile',
      cookie,
      payload: {
        firstName: 'Cliente',
        lastName: `Número ${emailCounter}`,
        phone: `11 4000-${String(1000 + emailCounter)}`,
        acceptTransactional: true,
        acceptMarketing: false,
      },
    });
    expect(r.statusCode, r.body).toBe(200);
  }
  return { email, cookie };
}

function book(cookie: string, payload: Record<string, unknown>) {
  return ctx.inject({
    method: 'POST',
    url: '/v1/me/appointments',
    cookie,
    payload: {
      branchId: ctx.ids.branchId,
      serviceIds: [services.Corte],
      barberId: juan,
      date: TUESDAY,
      ...payload,
    },
  });
}

function staffCreate(payload: Record<string, unknown>, cookie = owner) {
  return ctx.inject({
    method: 'POST',
    url: `/v1/branches/${ctx.ids.branchId}/appointments`,
    cookie,
    payload: {
      barberId: juan,
      customerId: customerIds[0],
      serviceIds: [services.Corte],
      date: TUESDAY,
      ...payload,
    },
  });
}

async function publicAvailability(query: string): Promise<Availability> {
  const r = await ctx.inject({ method: 'GET', url: `/v1/public/branches/principal/availability?${query}` });
  expect(r.statusCode, r.body).toBe(200);
  return r.json();
}

const timesOf = (a: Availability, date = TUESDAY) =>
  a.days.find((d) => d.date === date)?.slots.map((s) => s.time) ?? [];

describe('fechas en la base', () => {
  it('se guardan como el instante real (sesión en UTC), sin importar la zona del servidor', async () => {
    const [row] = await ctx.db.$queryRaw<{ s: string; drift: number }[]>`
      SELECT (${new Date('2026-10-13T13:00:00.000Z')}::timestamptz AT TIME ZONE 'UTC')::text AS s,
             abs(extract(epoch FROM now()) * 1000 - ${Date.now()})::float AS drift`;
    expect(row!.s).toBe('2026-10-13 13:00:00');
    expect(row!.drift).toBeLessThan(5_000);
  });
});

describe('página pública y disponibilidad', () => {
  it('muestra la sucursal con servicios, barberos y reglas sin login', async () => {
    const r = await ctx.inject({ method: 'GET', url: '/v1/public/branches/principal' });
    expect(r.statusCode).toBe(200);
    const branch: PublicBranch = r.json();
    expect(branch.services.map((s) => s.name)).toContain('Corte');
    expect(branch.barbers.map((b) => b.displayName)).toEqual(['Juan', 'Pedro']);
    expect(branch.rules).toMatchObject({ minNoticeMinutes: 60, maxDaysAhead: 30, maxActivePerCustomer: 2 });
    expect((await ctx.inject({ method: 'GET', url: '/v1/public/branches/no-existe' })).statusCode).toBe(404);
  });

  it('horarios cada 15 min, en hora de Buenos Aires, y nada los días sin horario', async () => {
    const a = await publicAvailability(
      `serviceIds=${services.Corte}&barberId=${juan}&from=2026-10-12&days=2`,
    );
    expect(timesOf(a, '2026-10-12')).toEqual([]); // lunes: no trabaja
    const tuesday = timesOf(a);
    expect(tuesday.slice(0, 3)).toEqual(['11:00', '11:15', '11:30']);
    expect(tuesday.at(-1)).toBe('19:00'); // el turno dura 1 hora: el último termina a las 20:00
    const first = a.days.find((d) => d.date === TUESDAY)!.slots[0]!;
    expect(first.startsAt).toBe('2026-10-13T14:00:00.000Z');
  });

  it('anticipación mínima de 60 minutos', async () => {
    ctx.clock.now = new Date('2026-10-13T11:20:00-03:00');
    const a = await publicAvailability(
      `serviceIds=${services.Corte}&barberId=${juan}&from=${TUESDAY}&days=1`,
    );
    expect(timesOf(a)[0]).toBe('12:30');
  });

  it('no ofrece más allá de 30 días', async () => {
    const a = await publicAvailability(`serviceIds=${services.Corte}&from=2026-11-08&days=7`);
    expect(a.lastDate).toBe('2026-11-11');
    expect(a.days.map((d) => d.date).at(-1)).toBe('2026-11-11');
  });

  it('bloqueos del barbero y feriados de la sucursal quitan horarios', async () => {
    await ctx.db.barberTimeOff.create({
      data: {
        barberId: juan,
        type: 'PERSONAL',
        startsAt: new Date('2026-10-13T10:00:00-03:00'),
        endsAt: new Date('2026-10-13T12:00:00-03:00'),
      },
    });
    let a = await publicAvailability(`serviceIds=${services.Corte}&barberId=${juan}&from=${TUESDAY}&days=1`);
    expect(timesOf(a)[0]).toBe('12:00');
    await ctx.db.branchClosure.create({
      data: {
        branchId: ctx.ids.branchId,
        reason: 'Feriado',
        startsAt: new Date('2026-10-13T00:00:00-03:00'),
        endsAt: new Date('2026-10-14T00:00:00-03:00'),
      },
    });
    a = await publicAvailability(`serviceIds=${services.Corte}&from=${TUESDAY}&days=1`);
    expect(timesOf(a)).toEqual([]);
  });

  it('varios servicios suman duración y el override del barbero cuenta', async () => {
    await ctx.db.barberService.update({
      where: { barberId_serviceId: { barberId: juan, serviceId: services.Barba! } },
      data: { durationMinOverride: 30 },
    });
    const a = await publicAvailability(
      `serviceIds=${services.Corte},${services.Barba}&barberId=${juan}&from=${TUESDAY}&days=1`,
    );
    // 60 + 30 = 90 min: el último empieza 18:30 y termina justo a las 20:00.
    expect(timesOf(a).at(-1)).toBe('18:30');
    await ctx.db.barberService.update({
      where: { barberId_serviceId: { barberId: juan, serviceId: services.Barba! } },
      data: { durationMinOverride: null },
    });
  });
});

describe('reserva online', () => {
  it('reserva, congela precio y duración, y deja la confirmación en la bandeja de salida', async () => {
    const { cookie, email } = await newCustomer();
    const r = await book(cookie, {
      time: '11:00',
      serviceIds: [services.Corte, services.Barba],
      notes: 'Degradé',
    });
    expect(r.statusCode, r.body).toBe(201);
    const mine: MyAppointment = r.json();
    expect(mine).toMatchObject({
      status: 'BOOKED',
      barberName: 'Juan',
      totalCents: PRECIO.corte + PRECIO.barba,
      canChange: true,
    });
    expect(mine.startsAt).toBe('2026-10-13T14:00:00.000Z');
    // Corte y barba: dos turnos de una hora.
    expect(mine.endsAt).toBe('2026-10-13T16:00:00.000Z');

    const pending = await findDueNotifications({ db: ctx.db, now: () => ctx.clock.now });
    expect(pending).toHaveLength(1);
    ctx.mailer.sent.length = 0;
    const result = await sendNotification(coreDeps(), pending[0]!.id);
    expect(result).toBe('SENT');
    const sent = ctx.mailer.last()!;
    expect(sent.to).toBe(email);
    expect(sent.subject).toContain('Turno confirmado');
    expect(sent.text).toContain('martes 13 de octubre a las 11:00');
    expect(sent.text).toContain('Corte + Barba');
    // Repetir el job no manda dos veces.
    expect(await sendNotification(coreDeps(), pending[0]!.id)).toBe('NOOP');
  });

  it('pide completar el perfil antes de reservar', async () => {
    const { cookie } = await newCustomer({ completeProfile: false });
    const r = await book(cookie, { time: '11:00' });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe('PROFILE_REQUIRED');
  });

  it('rechaza horarios que no se ofrecen (ocupado, fuera de horario, poca anticipación)', async () => {
    const a = await newCustomer();
    const b = await newCustomer();
    expect((await book(a.cookie, { time: '11:00' })).statusCode).toBe(201);
    const taken = await book(b.cookie, { time: '11:15' });
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('SLOT_TAKEN');
    expect((await book(b.cookie, { time: '20:00' })).statusCode).toBe(409);
    expect((await book(b.cookie, { time: '11:10' })).statusCode).toBe(409); // fuera del paso de 15'
    ctx.clock.now = new Date('2026-10-13T11:30:00-03:00');
    expect((await book(b.cookie, { time: '12:00' })).statusCode).toBe(409); // menos de 60'
  });

  it('máximo 2 turnos futuros por cliente', async () => {
    const { cookie } = await newCustomer();
    expect((await book(cookie, { time: '11:00' })).statusCode).toBe(201);
    expect((await book(cookie, { time: '12:00' })).statusCode).toBe(201);
    const third = await book(cookie, { time: '13:00' });
    expect(third.statusCode).toBe(409);
    expect(third.json().error.code).toBe('TOO_MANY_ACTIVE');
  });

  it('"cualquier barbero" asigna al que tiene menos minutos reservados ese día', async () => {
    const a = await newCustomer();
    expect((await book(a.cookie, { time: '15:00', barberId: juan })).statusCode).toBe(201);
    const b = await newCustomer();
    const any = await book(b.cookie, { time: '11:00', barberId: null });
    expect(any.statusCode, any.body).toBe(201);
    expect(any.json().barberName).toBe('Pedro');
    // Pedro ocupado a las 11: el siguiente "cualquiera" a esa hora va con Juan.
    const c = await newCustomer();
    const any2 = await book(c.cookie, { time: '11:00', barberId: null });
    expect(any2.json().barberName).toBe('Juan');
    const row = await ctx.db.appointment.findUniqueOrThrow({ where: { id: any2.json().id } });
    expect(row.anyBarberRequested).toBe(true);
  });
});

describe('doble reserva con pedidos simultáneos', () => {
  it('de 10 pedidos al mismo barbero y horario, uno solo consigue el turno', async () => {
    // 10 pedidos a la vez: 16:00 y 16:15 se pisan (el corte dura 40 min).
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        staffCreate({ customerId: customerIds[i % 6], time: i % 2 ? '16:15' : '16:00' }),
      ),
    );
    const codes = responses.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
    for (const r of responses.filter((x) => x.statusCode === 409)) {
      expect(r.json().error.code).toBe('SLOT_TAKEN');
    }
    expect(await ctx.db.appointment.count({ where: { barberId: juan } })).toBe(1);
  });

  it('clientes online simultáneos por el mismo horario: uno solo', async () => {
    const people = [];
    for (let i = 0; i < 4; i++) people.push(await newCustomer());
    const responses = await Promise.all(people.map((p) => book(p.cookie, { time: '17:00' })));
    expect(responses.map((r) => r.statusCode).sort()).toEqual([201, 409, 409, 409]);
  });

  it('la restricción de la base es la última garantía (se traduce a 409)', async () => {
    const base = {
      organizationId: ctx.ids.organizationId,
      branchId: ctx.ids.branchId,
      barberId: juan,
      customerId: customerIds[0]!,
      status: 'BOOKED' as const,
      source: 'STAFF' as const,
    };
    await ctx.db.appointment.create({
      data: { ...base, startsAt: new Date('2026-10-13T13:00:00Z'), endsAt: new Date('2026-10-13T13:40:00Z') },
    });
    const error = await ctx.db.appointment
      .create({
        data: {
          ...base,
          startsAt: new Date('2026-10-13T13:20:00Z'),
          endsAt: new Date('2026-10-13T14:00:00Z'),
        },
      })
      .catch((e: unknown) => e);
    expect(isSlotConflict(error)).toBe(true);
  });
});

describe('mis turnos: cancelar y reprogramar', () => {
  it('lista próximos, reprograma (libera el horario anterior) y avisa', async () => {
    const { cookie } = await newCustomer();
    const id = (await book(cookie, { time: '11:00' })).json().id as string;

    const slots = await ctx.inject({
      method: 'GET',
      url: `/v1/me/appointments/${id}/availability?from=${TUESDAY}&days=1`,
      cookie,
    });
    expect(slots.statusCode, slots.body).toBe(200);
    expect(timesOf(slots.json())[0]).toBe('11:00'); // su propio horario cuenta como libre

    const moved = await ctx.inject({
      method: 'POST',
      url: `/v1/me/appointments/${id}/reschedule`,
      cookie,
      payload: { date: TUESDAY, time: '14:00' },
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json().startsAt).toBe('2026-10-13T17:00:00.000Z');

    const other = await newCustomer();
    expect((await book(other.cookie, { time: '11:00' })).statusCode).toBe(201);

    const list: MyAppointments = (
      await ctx.inject({ method: 'GET', url: '/v1/me/appointments', cookie })
    ).json();
    expect(list.upcoming).toHaveLength(1);
    const events = await ctx.db.appointmentEvent.findMany({ where: { appointmentId: id } });
    expect(events.map((e) => e.type).sort()).toEqual(['CREATED', 'RESCHEDULED']);
    const types = (await ctx.db.notification.findMany({ where: { appointmentId: id } })).map((n) => n.type);
    expect(types.sort()).toEqual(['BOOKING_CONFIRMATION', 'BOOKING_RESCHEDULED']);
  });

  it('reprogramar hasta 3 horas antes; cancelar, hasta la hora del turno', async () => {
    const { cookie } = await newCustomer();
    const id = (await book(cookie, { time: '11:00' })).json().id as string;

    ctx.clock.now = new Date('2026-10-13T09:00:00-03:00');
    const list: MyAppointments = (
      await ctx.inject({ method: 'GET', url: '/v1/me/appointments', cookie })
    ).json();
    expect(list.upcoming[0]).toMatchObject({ canChange: false, canCancel: true });
    const late = await ctx.inject({
      method: 'POST',
      url: `/v1/me/appointments/${id}/reschedule`,
      cookie,
      payload: { date: TUESDAY, time: '15:00' },
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.message).toContain('3 horas');

    ctx.clock.now = new Date('2026-10-13T11:00:00-03:00');
    const started = await ctx.inject({ method: 'POST', url: `/v1/me/appointments/${id}/cancel`, cookie });
    expect(started.statusCode).toBe(409);

    ctx.clock.now = new Date('2026-10-13T10:55:00-03:00');
    const ok = await ctx.inject({ method: 'POST', url: `/v1/me/appointments/${id}/cancel`, cookie });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(ok.json().status).toBe('CANCELED');
    const n = await ctx.db.notification.findFirstOrThrow({
      where: { appointmentId: id, type: 'BOOKING_CANCELLATION' },
    });
    expect(n.status).toBe('PENDING');
  });

  it('un cliente no ve ni toca turnos ajenos', async () => {
    const a = await newCustomer();
    const b = await newCustomer();
    const id = (await book(a.cookie, { time: '11:00' })).json().id as string;
    expect(
      (await ctx.inject({ method: 'POST', url: `/v1/me/appointments/${id}/cancel`, cookie: b.cookie }))
        .statusCode,
    ).toBe(404);
  });
});

describe('agenda del panel', () => {
  it('fuera del horario pide confirmación; con force se agenda; pisar otro turno nunca', async () => {
    const outside = await staffCreate({ time: '20:30' });
    expect(outside.statusCode).toBe(409);
    expect(outside.json().error).toMatchObject({
      code: 'OUTSIDE_SCHEDULE',
      details: { problem: 'OUTSIDE_SCHEDULE' },
    });
    expect((await staffCreate({ time: '20:30', force: true })).statusCode).toBe(201);
    const clash = await staffCreate({ time: '20:45', force: true, customerId: customerIds[1] });
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.code).toBe('SLOT_TAKEN');
  });

  it('muestra columnas por barbero con su horario y los turnos del día', async () => {
    await staffCreate({ time: '11:00' });
    const r = await ctx.inject({
      method: 'GET',
      url: `/v1/branches/${ctx.ids.branchId}/agenda?date=${TUESDAY}`,
      cookie: owner,
    });
    expect(r.statusCode, r.body).toBe(200);
    const agenda: Agenda = r.json();
    expect(agenda.barbers.map((b) => b.displayName)).toEqual(['Juan', 'Pedro']);
    expect(agenda.barbers[0]!.workingHours).toEqual([{ date: TUESDAY, startMinute: 660, endMinute: 1200 }]);
    expect(agenda.appointments).toHaveLength(1);
    expect(agenda.appointments[0]).toMatchObject({ customerName: 'Martín Gómez', status: 'BOOKED' });
  });

  it('mover de barbero y hora queda en el historial y avisa al cliente', async () => {
    const id = (await staffCreate({ time: '11:00' })).json().id as string;
    const r = await ctx.inject({
      method: 'PATCH',
      url: `/v1/appointments/${id}`,
      cookie: owner,
      payload: { barberId: pedro, time: '12:00' },
    });
    expect(r.statusCode, r.body).toBe(200);
    const detail: AppointmentDetail = r.json();
    expect(detail.barberName).toBe('Pedro');
    expect(detail.events.map((e) => e.type)).toEqual(['CREATED', 'RESCHEDULED', 'REASSIGNED']);
    expect(
      await ctx.db.notification.count({ where: { appointmentId: id, type: 'BOOKING_RESCHEDULED' } }),
    ).toBe(1);
  });

  it('cambiar servicios recalcula duración y precio (los que ya estaban mantienen su precio)', async () => {
    const id = (await staffCreate({ time: '11:00' })).json().id as string;
    await ctx.db.service.update({ where: { id: services.Corte! }, data: { basePriceCents: 99_999_00n } });
    const r = await ctx.inject({
      method: 'PATCH',
      url: `/v1/appointments/${id}`,
      cookie: owner,
      payload: { serviceIds: [services.Corte, services.Barba] },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().bookedTotalCents).toBe(PRECIO.corte + PRECIO.barba);
    expect(r.json().endsAt).toBe('2026-10-13T16:00:00.000Z');
    await ctx.db.service.update({
      where: { id: services.Corte! },
      data: { basePriceCents: BigInt(PRECIO.corte) },
    });
  });

  it('estados: confirmar, "no vino" solo después de la hora, y revertirlo queda auditado', async () => {
    const id = (await staffCreate({ time: '11:00' })).json().id as string;
    const status = (s: string) =>
      ctx.inject({
        method: 'POST',
        url: `/v1/appointments/${id}/status`,
        cookie: owner,
        payload: { status: s },
      });
    expect((await status('CONFIRMED')).json().status).toBe('CONFIRMED');
    expect((await status('NO_SHOW')).statusCode).toBe(409);
    ctx.clock.now = new Date('2026-10-13T11:30:00-03:00');
    expect((await status('NO_SHOW')).json().status).toBe('NO_SHOW');
    expect((await status('COMPLETED')).statusCode).toBe(409);
    expect((await status('BOOKED')).json().status).toBe('BOOKED');
    expect(
      await ctx.db.auditLog.count({ where: { action: 'APPOINTMENT_NO_SHOW_REVERTED', entityId: id } }),
    ).toBe(1);
  });

  it('atención sin turno: empieza ahora, en curso, sin cliente obligatorio', async () => {
    ctx.clock.now = new Date('2026-10-13T15:07:30-03:00');
    const r = await ctx.inject({
      method: 'POST',
      url: `/v1/branches/${ctx.ids.branchId}/walk-ins`,
      cookie: owner,
      payload: { barberId: pedro, serviceIds: [services.Barba] },
    });
    expect(r.statusCode, r.body).toBe(201);
    expect(r.json()).toMatchObject({ status: 'IN_PROGRESS', source: 'WALK_IN', customerId: null });
    expect(r.json().startsAt).toBe('2026-10-13T18:07:00.000Z');
  });

  it('cancelar desde el panel libera el horario y avisa', async () => {
    const id = (await staffCreate({ time: '11:00' })).json().id as string;
    const r = await ctx.inject({
      method: 'POST',
      url: `/v1/appointments/${id}/cancel`,
      cookie: owner,
      payload: { reason: 'CUSTOMER_REQUEST' },
    });
    expect(r.json()).toMatchObject({ status: 'CANCELED', cancelReason: 'CUSTOMER_REQUEST' });
    expect((await staffCreate({ time: '11:00', customerId: customerIds[1] })).statusCode).toBe(201);
  });

  it('recepción de otra sucursal no ve ni toca turnos de esta', async () => {
    const norte = await ctx.db.branch.create({
      data: { organizationId: ctx.ids.organizationId, name: 'Norte', slug: `norte-${Date.now()}` },
    });
    const reception = await inviteAndAccept(ctx, owner, {
      email: `recepcion-${Date.now()}@estoicos.test`,
      role: 'RECEPTION',
      branchIds: [norte.id],
    });
    const id = (await staffCreate({ time: '11:00' })).json().id as string;
    expect(
      (await ctx.inject({ method: 'GET', url: `/v1/appointments/${id}`, cookie: reception })).statusCode,
    ).toBe(403);
    expect(
      (
        await ctx.inject({
          method: 'GET',
          url: `/v1/branches/${ctx.ids.branchId}/agenda?date=${TUESDAY}`,
          cookie: reception,
        })
      ).statusCode,
    ).toBe(403);
  });
});

describe('ficha del cliente', () => {
  it('muestra el historial de turnos y las ausencias', async () => {
    const id = (await staffCreate({ time: '11:00' })).json().id as string;
    ctx.clock.now = new Date('2026-10-13T11:00:00-03:00');
    await ctx.inject({
      method: 'POST',
      url: `/v1/appointments/${id}/status`,
      cookie: owner,
      payload: { status: 'NO_SHOW' },
    });
    const r = await ctx.inject({ method: 'GET', url: `/v1/customers/${customerIds[0]}`, cookie: owner });
    expect(r.json().stats.noShows).toBe(1);
    expect(r.json().appointments[0]).toMatchObject({
      status: 'NO_SHOW',
      barberName: 'Juan',
      services: ['Corte'],
    });
  });

  it('fusiona un duplicado: pasan los turnos y datos faltantes, y el repetido desaparece de la búsqueda', async () => {
    const keep = await ctx.db.customer.create({
      data: {
        organizationId: ctx.ids.organizationId,
        firstName: 'Ramiro',
        lastName: 'Paz',
        phone: '+5491170000001',
        source: 'IN_STORE',
        searchText: 'ramiro paz 5491170000001',
      },
    });
    const dup = await ctx.db.customer.create({
      data: {
        organizationId: ctx.ids.organizationId,
        firstName: 'Rami',
        lastName: 'Paz',
        email: 'rami.paz@example.com',
        source: 'ONLINE_BOOKING',
        searchText: 'rami paz rami.paz@example.com',
        consents: { create: { channel: 'EMAIL', scope: 'TRANSACTIONAL', granted: true } },
      },
    });
    await staffCreate({ time: '11:00', customerId: dup.id });

    const r = await ctx.inject({
      method: 'POST',
      url: `/v1/customers/${keep.id}/merge`,
      cookie: owner,
      payload: { duplicateId: dup.id },
    });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ email: 'rami.paz@example.com', stats: { appointments: 1 } });
    expect(r.json().consents.transactional).toBe(true);

    const search = await ctx.inject({ method: 'GET', url: '/v1/customers?q=paz', cookie: owner });
    expect(search.json().map((c: { id: string }) => c.id)).toEqual([keep.id]);
    expect(await ctx.db.auditLog.count({ where: { action: 'CUSTOMER_MERGED', entityId: keep.id } })).toBe(1);
    expect(
      (await ctx.inject({ method: 'GET', url: `/v1/customers/${dup.id}`, cookie: owner })).statusCode,
    ).toBe(404);
  });

  it('solo el dueño o el encargado fusionan', async () => {
    const reception = await inviteAndAccept(ctx, owner, {
      email: `recepcion-merge-${Date.now()}@estoicos.test`,
      role: 'RECEPTION',
      branchIds: [ctx.ids.branchId],
    });
    const r = await ctx.inject({
      method: 'POST',
      url: `/v1/customers/${customerIds[0]}/merge`,
      cookie: reception,
      payload: { duplicateId: customerIds[1] },
    });
    expect(r.statusCode).toBe(403);
  });
});

/** Dependencias del core con el mismo reloj y mailer que la app de test. */
function coreDeps() {
  return {
    db: ctx.db,
    mailer: ctx.mailer,
    encryptor: { encrypt: (v: string) => v, decrypt: (v: string) => v },
    config: { authCodeSecret: 'x', appPublicUrl: 'http://localhost:3000' },
    log: { info() {}, warn() {}, error() {} },
    now: () => ctx.clock.now,
  };
}
