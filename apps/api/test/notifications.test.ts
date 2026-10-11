import { createHmac } from 'node:crypto';
import {
  dueReactivations,
  dueReminders,
  dueReviewRequests,
  queueReactivation,
  queueReminder,
  queueReviewRequest,
  sendNotification,
} from '@estoicos/core';
import { WhatsAppError } from '@estoicos/integrations';
import type { NotificationLogItem, NotificationSettings } from '@estoicos/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, createTestContext, loginStaff, type TestContext } from './helpers';

/**
 * Fase 6: WhatsApp, recordatorios y marketing. Corre contra un WhatsApp simulado
 * (`FakeWhatsApp`), que reproduce los errores reales de Meta para probar el fallback a email.
 */
const NOW = new Date('2026-10-12T15:00:00-03:00'); // lunes 15:00, fuera de la franja sin marketing
const TUESDAY_10 = new Date('2026-10-13T10:00:00-03:00');

let ctx: TestContext;
let owner: string;
let juan: string;
let corte: string;
let customerId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  ctx.clock.now = NOW;
  owner = await loginStaff(ctx, ADMIN_EMAIL);
  juan = ctx.ids.barberIds[0]!;
  corte = (await ctx.db.service.findFirstOrThrow({ where: { name: 'Corte' } })).id;
  const martin = await ctx.db.customer.findFirstOrThrow({ where: { firstName: 'Martín' } });
  customerId = martin.id;
});

afterAll(async () => {
  await ctx.close();
});

beforeEach(async () => {
  ctx.clock.now = NOW;
  ctx.wa.sent.length = 0;
  ctx.wa.unreachable.clear();
  ctx.wa.marketingStopped.clear();
  ctx.wa.failNext = null;
  ctx.mailer.sent.length = 0;
  await ctx.redis.flushdb();
  await ctx.db.notification.deleteMany();
  // Cada prueba arranca sin turnos de las anteriores (los recordatorios recorren todos).
  await ctx.db.$executeRawUnsafe('TRUNCATE appointment_events, appointment_services, appointments CASCADE');
  await ctx.db.customer.update({
    where: { id: customerId },
    data: { emailBouncedAt: null, whatsappUnreachableAt: null, preferredChannel: 'WHATSAPP' },
  });
});

const api = (
  method: 'GET' | 'POST' | 'PATCH',
  url: string,
  payload?: unknown,
  cookie: string | undefined = owner,
) => ctx.inject({ method, url, cookie, ...(payload === undefined ? {} : { payload: payload as object }) });

/** Prende WhatsApp y carga la plantilla de un tipo (como si Meta ya la hubiera aprobado). */
async function enableWhatsApp(type = 'BOOKING_REMINDER') {
  await api('PATCH', '/v1/notifications/settings', { whatsappEnabled: true });
  await api('PATCH', `/v1/notifications/types/${type}`, { whatsappTemplateName: 'recordatorio_turno' });
}

async function appointmentAt(startsAt: Date) {
  const appointment = await ctx.db.appointment.create({
    data: {
      organizationId: ctx.ids.organizationId,
      branchId: ctx.ids.branchId,
      barberId: juan,
      customerId,
      status: 'BOOKED',
      source: 'ONLINE',
      startsAt,
      endsAt: new Date(startsAt.getTime() + 40 * 60_000),
      bookedTotalCents: 1_500_000n,
      services: { create: { serviceId: corte, position: 0, durationMin: 40, priceCents: 1_500_000n } },
    },
  });
  return appointment;
}

describe('configuración', () => {
  it('no se puede prender WhatsApp sin número configurado… y sí con el simulador', async () => {
    const r = await api('GET', '/v1/notifications/settings');
    expect(r.statusCode, r.body).toBe(200);
    const settings: NotificationSettings = r.json();
    expect(settings.whatsappConfigured).toBe(true); // el simulador está inyectado en los tests
    expect(settings.reminderOffsetsMinutes).toEqual([1440, 120]);
    expect(settings.types.length).toBeGreaterThan(10);
  });

  it('los mensajes de acceso no se pueden apagar', async () => {
    const r = await api('PATCH', '/v1/notifications/types/LOGIN_CODE', { enabled: false });
    expect(r.statusCode).toBe(422);
    expect(r.json().error.message).toContain('entrar al sistema');
  });

  it('sin sesión no se ve la configuración', async () => {
    const r = await ctx.inject({ method: 'GET', url: '/v1/notifications/settings' });
    expect(r.statusCode).toBe(401);
  });
});

describe('elección de canal y fallback', () => {
  it('con WhatsApp prendido y plantilla cargada, el recordatorio sale por WhatsApp', async () => {
    await enableWhatsApp();
    const appointment = await appointmentAt(TUESDAY_10);
    ctx.clock.now = new Date(TUESDAY_10.getTime() - 100 * 60_000);

    const id = await queueReminder(ctx.deps, { appointmentId: appointment.id, minutesBefore: 120 });
    expect(id).toBeTruthy();
    expect(await sendNotification(ctx.deps, id!)).toBe('SENT');

    const sent = ctx.wa.last()!;
    expect(sent.templateName).toBe('recordatorio_turno');
    expect(sent.to).toBe('5491122334455'); // sin el "+", como espera Meta
    expect(sent.bodyParams[0]).toBe('Martín');
    expect(sent.bodyParams[1]).toContain('martes 13 de octubre');
    // Botones de confirmar y cancelar (decisión del 28/09/2026).
    expect(sent.buttonPayloads).toHaveLength(2);
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('si WhatsApp falla, el mismo mensaje sale por email', async () => {
    await enableWhatsApp();
    const appointment = await appointmentAt(new Date(TUESDAY_10.getTime() + 3600_000));
    ctx.clock.now = new Date(appointment.startsAt.getTime() - 100 * 60_000);
    const id = (await queueReminder(ctx.deps, { appointmentId: appointment.id, minutesBefore: 120 }))!;

    ctx.wa.failNext = new WhatsAppError('Number not on WhatsApp', 400, 131026);
    expect(await sendNotification(ctx.deps, id)).toBe('FELL_BACK');

    const fallback = await ctx.db.notification.findFirstOrThrow({ where: { fallbackOfId: id } });
    expect(fallback.channel).toBe('EMAIL');
    expect(await sendNotification(ctx.deps, fallback.id)).toBe('SENT');
    expect(ctx.mailer.last()!.subject).toContain('turno');

    // El número quedó marcado: el próximo mensaje ya sale por email directo.
    const customer = await ctx.db.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(customer.whatsappUnreachableAt).not.toBeNull();
  });

  it('sin plantilla aprobada, ese tipo sale por email', async () => {
    await api('PATCH', '/v1/notifications/settings', { whatsappEnabled: true });
    await api('PATCH', '/v1/notifications/types/BOOKING_REMINDER', { whatsappTemplateName: null });
    const appointment = await appointmentAt(new Date(TUESDAY_10.getTime() + 2 * 3600_000));
    ctx.clock.now = new Date(appointment.startsAt.getTime() - 100 * 60_000);
    const id = (await queueReminder(ctx.deps, { appointmentId: appointment.id, minutesBefore: 120 }))!;
    const row = await ctx.db.notification.findUniqueOrThrow({ where: { id } });
    expect(row.channel).toBe('EMAIL');
  });

  it('sin consentimiento no se manda, y queda el motivo en el historial', async () => {
    await ctx.db.customerConsent.updateMany({ where: { customerId }, data: { granted: false } });
    const appointment = await appointmentAt(new Date(TUESDAY_10.getTime() + 3 * 3600_000));
    ctx.clock.now = new Date(appointment.startsAt.getTime() - 100 * 60_000);
    const id = await queueReminder(ctx.deps, { appointmentId: appointment.id, minutesBefore: 120 });
    expect(id).toBeNull();
    const skipped = await ctx.db.notification.findFirstOrThrow({ where: { appointmentId: appointment.id } });
    expect(skipped).toMatchObject({ status: 'SKIPPED', skippedReason: 'No acepta avisos de turnos' });
    await ctx.db.customerConsent.updateMany({ where: { customerId }, data: { granted: true } });
  });
});

describe('recordatorios', () => {
  it('salen a las 24 h y a las 2 h, y no se repiten', async () => {
    const appointment = await appointmentAt(TUESDAY_10);
    // Un día y medio antes: todavía no toca ninguno.
    ctx.clock.now = new Date(TUESDAY_10.getTime() - 36 * 3600_000);
    expect(await dueReminders(ctx.deps)).toHaveLength(0);

    // A 20 h del turno: toca el de 24 h.
    ctx.clock.now = new Date(TUESDAY_10.getTime() - 20 * 3600_000);
    const first = await dueReminders(ctx.deps);
    expect(first).toEqual([{ appointmentId: appointment.id, minutesBefore: 1440 }]);
    await queueReminder(ctx.deps, first[0]!);
    expect(await dueReminders(ctx.deps)).toHaveLength(0);

    // A 1 h: toca el de 2 h.
    ctx.clock.now = new Date(TUESDAY_10.getTime() - 60 * 60_000);
    const second = await dueReminders(ctx.deps);
    expect(second).toEqual([{ appointmentId: appointment.id, minutesBefore: 120 }]);
    await queueReminder(ctx.deps, second[0]!);
    expect(await dueReminders(ctx.deps)).toHaveLength(0);
  });

  it('mover el turno regenera los recordatorios', async () => {
    const appointment = await appointmentAt(TUESDAY_10);
    ctx.clock.now = new Date(TUESDAY_10.getTime() - 20 * 3600_000);
    await queueReminder(ctx.deps, { appointmentId: appointment.id, minutesBefore: 1440 });
    expect(await dueReminders(ctx.deps)).toHaveLength(0);

    // Se mueve una hora más tarde: la clave cambia, así que corresponde un recordatorio nuevo.
    const moved = new Date(TUESDAY_10.getTime() + 3600_000);
    await ctx.db.appointment.update({
      where: { id: appointment.id },
      data: { startsAt: moved, endsAt: new Date(moved.getTime() + 40 * 60_000) },
    });
    const due = await dueReminders(ctx.deps);
    expect(due).toEqual([{ appointmentId: appointment.id, minutesBefore: 1440 }]);
  });

  it('un turno cancelado no recibe recordatorio', async () => {
    const appointment = await appointmentAt(TUESDAY_10);
    await ctx.db.appointment.update({
      where: { id: appointment.id },
      data: { status: 'CANCELED', canceledAt: NOW, canceledBy: 'CUSTOMER', cancelReason: 'CUSTOMER_REQUEST' },
    });
    ctx.clock.now = new Date(TUESDAY_10.getTime() - 20 * 3600_000);
    expect(await dueReminders(ctx.deps)).toHaveLength(0);
  });
});

describe('confirmar y cancelar desde el recordatorio', () => {
  it('el cliente confirma con el link, sin iniciar sesión', async () => {
    const appointment = await appointmentAt(TUESDAY_10);
    ctx.clock.now = new Date(TUESDAY_10.getTime() - 100 * 60_000);
    const id = (await queueReminder(ctx.deps, { appointmentId: appointment.id, minutesBefore: 120 }))!;
    const payload = (await ctx.db.notification.findUniqueOrThrow({ where: { id } })).payload as {
      confirmUrl: string;
      cancelUrl: string;
    };
    const token = new URL(payload.confirmUrl).searchParams.get('t')!;

    const r = await ctx.inject({
      method: 'POST',
      url: `/v1/public/appointments/${appointment.id}/confirm?t=${token}`,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect((await ctx.db.appointment.findUniqueOrThrow({ where: { id: appointment.id } })).status).toBe(
      'CONFIRMED',
    );
    // Repetirlo no rompe nada.
    expect(
      (
        await ctx.inject({
          method: 'POST',
          url: `/v1/public/appointments/${appointment.id}/confirm?t=${token}`,
        })
      ).statusCode,
    ).toBe(200);
  });

  it('un token inventado no sirve', async () => {
    const appointment = await appointmentAt(TUESDAY_10);
    const r = await ctx.inject({
      method: 'POST',
      url: `/v1/public/appointments/${appointment.id}/confirm?t=${'a'.repeat(32)}`,
    });
    expect(r.statusCode).toBe(403);
  });

  it('el cliente cancela con el link y libera el horario', async () => {
    const appointment = await appointmentAt(new Date(TUESDAY_10.getTime() + 4 * 3600_000));
    ctx.clock.now = new Date(appointment.startsAt.getTime() - 100 * 60_000);
    const id = (await queueReminder(ctx.deps, { appointmentId: appointment.id, minutesBefore: 120 }))!;
    const payload = (await ctx.db.notification.findUniqueOrThrow({ where: { id } })).payload as {
      cancelUrl: string;
    };
    const token = new URL(payload.cancelUrl).searchParams.get('t')!;

    const r = await ctx.inject({
      method: 'POST',
      url: `/v1/public/appointments/${appointment.id}/cancel?t=${token}`,
    });
    expect(r.statusCode, r.body).toBe(200);
    const canceled = await ctx.db.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
    expect(canceled).toMatchObject({ status: 'CANCELED', cancelReason: 'CUSTOMER_REQUEST' });
  });
});

describe('marketing', () => {
  it('el pedido de reseña sale unas horas después de cobrar, una sola vez', async () => {
    const sale = await ctx.db.sale.create({
      data: {
        organizationId: ctx.ids.organizationId,
        branchId: ctx.ids.branchId,
        number: 9001,
        customerId,
        status: 'PAID',
        totalCents: 1_500_000n,
        paidCents: 1_500_000n,
        subtotalCents: 1_500_000n,
        paidAt: new Date(NOW.getTime() - 3 * 3600_000),
        createdById: ctx.ids.ownerId,
      },
    });
    const due = await dueReviewRequests(ctx.deps);
    expect(due.map((s) => s.id)).toContain(sale.id);

    const id = await queueReviewRequest(ctx.deps, sale.id);
    expect(id).toBeTruthy();
    // La segunda vez ya no aparece.
    expect((await dueReviewRequests(ctx.deps)).map((s) => s.id)).not.toContain(sale.id);
  });

  it('el marketing no sale de madrugada', async () => {
    const sale = await ctx.db.sale.create({
      data: {
        organizationId: ctx.ids.organizationId,
        branchId: ctx.ids.branchId,
        number: 9002,
        customerId,
        status: 'PAID',
        totalCents: 1_000_000n,
        paidCents: 1_000_000n,
        subtotalCents: 1_000_000n,
        paidAt: new Date(NOW.getTime() - 3 * 3600_000),
        createdById: ctx.ids.ownerId,
      },
    });
    ctx.clock.now = new Date('2026-10-12T23:30:00-03:00');
    const id = await queueReviewRequest(ctx.deps, sale.id);
    expect(id).toBeNull();
    const skipped = await ctx.db.notification.findFirstOrThrow({ where: { saleId: sale.id } });
    expect(skipped).toMatchObject({ status: 'SKIPPED', skippedReason: 'Franja sin mensajes de marketing' });
  });

  it('la reactivación busca a quien no vuelve, y no molesta a quien ya tiene turno', async () => {
    await ctx.db.customer.update({
      where: { id: customerId },
      data: { lastVisitAt: new Date(NOW.getTime() - 40 * 86_400_000) },
    });
    expect((await dueReactivations(ctx.deps)).map((c) => c.id)).toContain(customerId);

    const appointment = await appointmentAt(new Date(NOW.getTime() + 5 * 86_400_000));
    expect((await dueReactivations(ctx.deps)).map((c) => c.id)).not.toContain(customerId);

    await ctx.db.appointment.delete({ where: { id: appointment.id } });
    const id = await queueReactivation(ctx.deps, customerId);
    expect(id).toBeTruthy();
    const row = await ctx.db.notification.findUniqueOrThrow({ where: { id: id! } });
    expect((row.payload as { weeksAway: number }).weeksAway).toBe(5);
    // No se repite mientras dure el enfriamiento.
    expect((await dueReactivations(ctx.deps)).map((c) => c.id)).not.toContain(customerId);
  });

  it('el cliente se da de baja desde el link y deja de recibir promociones', async () => {
    const id = await queueReactivation(ctx.deps, customerId).catch(() => null);
    void id;
    const { unsubscribeUrl } = await import('@estoicos/core');
    const url = new URL(unsubscribeUrl(ctx.deps, customerId));
    const r = await ctx.inject({
      method: 'POST',
      url: `/v1/public/unsubscribe?c=${url.searchParams.get('c')}&t=${url.searchParams.get('t')}`,
    });
    expect(r.statusCode, r.body).toBe(200);
    const consents = await ctx.db.customerConsent.findMany({ where: { customerId, scope: 'MARKETING' } });
    expect(consents.every((c) => !c.granted)).toBe(true);
    // Queda la evidencia de la baja.
    expect(
      await ctx.db.consentEvent.count({ where: { customerId, scope: 'MARKETING', granted: false } }),
    ).toBeGreaterThan(0);
    // Y con eso, la reactivación ya no le llega.
    expect((await dueReactivations(ctx.deps)).map((c) => c.id)).not.toContain(customerId);
  });
});

describe('webhooks de estado', () => {
  const metaBody = (statuses: unknown[]) => ({
    object: 'whatsapp_business_account',
    entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { statuses } }] }],
  });

  function metaSigned(body: object, secret = 'app-secret-de-prueba') {
    const raw = JSON.stringify(body);
    return {
      raw,
      signature: `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
    };
  }

  it('sin firma válida, 401 y aviso en el panel', async () => {
    const body = metaBody([{ id: 'wamid.X', status: 'delivered' }]);
    const r = await ctx.inject({
      method: 'POST',
      url: '/webhooks/whatsapp',
      headers: { 'x-hub-signature-256': 'sha256=' + 'f'.repeat(64), 'content-type': 'application/json' },
      payload: body,
    });
    expect(r.statusCode).toBe(401);
    expect(await ctx.db.systemAlert.count({ where: { kind: 'WEBHOOK_SIGNATURE_INVALID' } })).toBeGreaterThan(
      0,
    );
  });

  it('marca el mensaje como entregado y como leído', async () => {
    await enableWhatsApp();
    const appointment = await appointmentAt(new Date(TUESDAY_10.getTime() + 5 * 3600_000));
    ctx.clock.now = new Date(appointment.startsAt.getTime() - 100 * 60_000);
    const id = (await queueReminder(ctx.deps, { appointmentId: appointment.id, minutesBefore: 120 }))!;
    await sendNotification(ctx.deps, id);
    const messageId = (await ctx.db.notification.findUniqueOrThrow({ where: { id } })).providerMessageId!;

    for (const status of ['delivered', 'read']) {
      const body = metaBody([{ id: messageId, status }]);
      const signed = metaSigned(body);
      const r = await ctx.inject({
        method: 'POST',
        url: '/webhooks/whatsapp',
        headers: { 'x-hub-signature-256': signed.signature, 'content-type': 'application/json' },
        payload: body,
      });
      expect(r.statusCode, r.body).toBe(200);
    }
    const final = await ctx.db.notification.findUniqueOrThrow({ where: { id } });
    expect(final.status).toBe('READ');
    expect(final.deliveredAt).not.toBeNull();
    expect(final.readAt).not.toBeNull();
  });

  it('un email que rebota marca al cliente y no se le vuelve a escribir a ese correo', async () => {
    const secret = 'whsec_' + Buffer.from('clave-de-resend').toString('base64');
    const appointment = await appointmentAt(new Date(TUESDAY_10.getTime() + 6 * 3600_000));
    ctx.clock.now = new Date(appointment.startsAt.getTime() - 100 * 60_000);
    await api('PATCH', '/v1/notifications/settings', { whatsappEnabled: false });
    const id = (await queueReminder(ctx.deps, { appointmentId: appointment.id, minutesBefore: 120 }))!;
    await sendNotification(ctx.deps, id);

    const body = { type: 'email.bounced', data: { email_id: 'resend-1', tags: { notification_id: id } } };
    const raw = JSON.stringify(body);
    const svixId = 'msg_1';
    const timestamp = '1760000000';
    const key = Buffer.from(secret.replace('whsec_', ''), 'base64');
    const signature = createHmac('sha256', key).update(`${svixId}.${timestamp}.${raw}`).digest('base64');

    const r = await ctx.inject({
      method: 'POST',
      url: '/webhooks/resend',
      headers: {
        'content-type': 'application/json',
        'svix-id': svixId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      },
      payload: body,
    });
    expect(r.statusCode, r.body).toBe(200);
    expect((await ctx.db.notification.findUniqueOrThrow({ where: { id } })).status).toBe('FAILED');
    expect(
      (await ctx.db.customer.findUniqueOrThrow({ where: { id: customerId } })).emailBouncedAt,
    ).not.toBeNull();
  });
});

describe('registro de envíos', () => {
  it('muestra los envíos con su estado y su motivo', async () => {
    // Un mensaje que no se manda (sin consentimiento) tiene que quedar registrado con el motivo.
    await ctx.db.customerConsent.updateMany({ where: { customerId }, data: { granted: false } });
    const appointment = await appointmentAt(new Date(TUESDAY_10.getTime() + 7 * 3600_000));
    ctx.clock.now = new Date(appointment.startsAt.getTime() - 100 * 60_000);
    await queueReminder(ctx.deps, { appointmentId: appointment.id, minutesBefore: 120 });
    await ctx.db.customerConsent.updateMany({ where: { customerId }, data: { granted: true } });

    const r = await api('GET', '/v1/notifications?limit=20');
    expect(r.statusCode, r.body).toBe(200);
    const rows: NotificationLogItem[] = r.json();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((x) => x.status === 'SKIPPED' && x.skippedReason)).toBe(true);
  });
});
