import { hmacSha256Hex, safeEqual } from '@estoicos/integrations';
import { ACTIVE_APPOINTMENT_STATUSES } from '@estoicos/shared';
import type { CoreDeps } from '../../deps';
import { Errors } from '../../errors';
import { cancelInTx } from '../booking/agenda';
import { bookingPayload } from './booking-notifications';
import { dispatchQueued, queueNotification } from './outbox';
import type { ReminderPayload } from './messages';

/**
 * Recordatorios de turno: 24 h y 2 h antes (decisión del 28/09/2026). Cada uno lleva sus
 * botones de **confirmar** y **cancelar**, para que el que no puede venir avise en un toque.
 *
 * La clave anti-duplicado incluye el horario del turno: si el turno se mueve, se manda un
 * recordatorio nuevo y el viejo queda cancelado.
 */
export function reminderDedupeKey(appointmentId: string, minutesBefore: number, startsAt: Date): string {
  return `reminder:${appointmentId}:${minutesBefore}:${startsAt.toISOString()}`;
}

/**
 * Token firmado que identifica la acción sobre un turno sin pedir login: va en el link del
 * email y en el botón de WhatsApp. No da acceso a nada más que confirmar o cancelar ESE turno.
 */
export function appointmentActionToken(
  secret: string,
  input: { appointmentId: string; action: 'confirm' | 'cancel'; startsAt: Date },
): string {
  return hmacSha256Hex(
    `${input.action}:${input.appointmentId}:${input.startsAt.toISOString()}`,
    secret,
  ).slice(0, 32);
}

export function verifyActionToken(
  secret: string,
  input: { appointmentId: string; action: 'confirm' | 'cancel'; startsAt: Date; token: string },
): boolean {
  return safeEqual(appointmentActionToken(secret, input), input.token);
}

/** Turnos que ya entraron en la ventana de un recordatorio y todavía no lo recibieron. */
export async function dueReminders(
  deps: CoreDeps,
  options: { limit?: number } = {},
): Promise<{ appointmentId: string; minutesBefore: number }[]> {
  const now = deps.now();
  const settings = await deps.db.organizationSettings.findFirst();
  const offsets = settings?.reminderOffsetsMinutes ?? [1440, 120];
  const maxOffset = Math.max(...offsets, 0);

  const appointments = await deps.db.appointment.findMany({
    where: {
      status: { in: ['BOOKED', 'CONFIRMED'] },
      startsAt: { gt: now, lte: new Date(now.getTime() + maxOffset * 60_000) },
      customerId: { not: null },
    },
    select: { id: true, startsAt: true },
    orderBy: { startsAt: 'asc' },
    take: options.limit ?? 200,
  });

  const due: { appointmentId: string; minutesBefore: number }[] = [];
  for (const appointment of appointments) {
    const minutesLeft = (appointment.startsAt.getTime() - now.getTime()) / 60_000;
    for (const offset of offsets) {
      // Se manda cuando faltan menos que el offset (nunca antes de tiempo).
      if (minutesLeft > offset) continue;
      const key = reminderDedupeKey(appointment.id, offset, appointment.startsAt);
      const already = await deps.db.notification.findUnique({
        where: { dedupeKey: key },
        select: { id: true },
      });
      if (!already) due.push({ appointmentId: appointment.id, minutesBefore: offset });
    }
  }
  return due;
}

/** Encola el recordatorio de un turno. Devuelve el id a despachar (o null). */
export async function queueReminder(
  deps: CoreDeps,
  input: { appointmentId: string; minutesBefore: number },
): Promise<string | null> {
  return deps.db.$transaction(async (tx) => {
    const appointment = await tx.appointment.findUnique({ where: { id: input.appointmentId } });
    if (!appointment || !['BOOKED', 'CONFIRMED'].includes(appointment.status)) return null;
    const data = await bookingPayload(tx, deps.config, input.appointmentId);
    if (!data) return null;

    const secret = deps.config.authCodeSecret;
    const confirmToken = appointmentActionToken(secret, {
      appointmentId: appointment.id,
      action: 'confirm',
      startsAt: appointment.startsAt,
    });
    const cancelToken = appointmentActionToken(secret, {
      appointmentId: appointment.id,
      action: 'cancel',
      startsAt: appointment.startsAt,
    });
    const base = `${deps.config.appPublicUrl}/turno/${appointment.id}`;
    const payload: ReminderPayload = {
      ...data.payload,
      minutesBefore: input.minutesBefore,
      confirmUrl: `${base}/confirmar?t=${confirmToken}`,
      cancelUrl: `${base}/cancelar?t=${cancelToken}`,
      confirmToken,
      cancelToken,
    };

    return queueNotification(tx, deps.config, {
      type: 'BOOKING_REMINDER',
      dedupeKey: reminderDedupeKey(appointment.id, input.minutesBefore, appointment.startsAt),
      customerId: data.customerId,
      organizationId: data.organizationId,
      branchId: data.branchId,
      appointmentId: appointment.id,
      payload,
      now: deps.now(),
    });
  });
}

/**
 * El cliente confirma su turno desde el recordatorio (link o botón de WhatsApp).
 * No pide login: alcanza con el token firmado de ESE turno.
 */
export async function confirmByToken(
  deps: CoreDeps,
  input: { appointmentId: string; token: string },
): Promise<{ startsAt: string; branchName: string; barberName: string }> {
  const appointment = await deps.db.appointment.findUnique({
    where: { id: input.appointmentId },
    include: { branch: { select: { name: true } }, barber: { select: { displayName: true } } },
  });
  if (!appointment) throw Errors.notFound('No encontramos ese turno.');
  if (
    !verifyActionToken(deps.config.authCodeSecret, {
      appointmentId: appointment.id,
      action: 'confirm',
      startsAt: appointment.startsAt,
      token: input.token,
    })
  ) {
    throw Errors.forbidden('Ese link ya no sirve. Entrá a tu cuenta para ver el turno.');
  }
  const info = {
    startsAt: appointment.startsAt.toISOString(),
    branchName: appointment.branch.name,
    barberName: appointment.barber.displayName,
  };
  if (appointment.status === 'CONFIRMED') return info;
  if (appointment.status !== 'BOOKED') throw Errors.conflict('Ese turno ya no está reservado.');

  const now = deps.now();
  await deps.db.$transaction(async (tx) => {
    const updated = await tx.appointment.updateMany({
      where: { id: appointment.id, status: 'BOOKED' },
      data: { status: 'CONFIRMED', confirmedAt: now, confirmedVia: 'CUSTOMER_LINK' },
    });
    if (updated.count === 0) return;
    await tx.appointmentEvent.create({
      data: {
        appointmentId: appointment.id,
        type: 'STATUS_CHANGED',
        fromStatus: 'BOOKED',
        toStatus: 'CONFIRMED',
        actorType: 'CUSTOMER',
        actorCustomerId: appointment.customerId,
        note: 'Confirmó desde el recordatorio',
      },
    });
  });
  return info;
}

/** El cliente cancela desde el recordatorio. Libera el horario al instante. */
export async function cancelByToken(
  deps: CoreDeps,
  input: { appointmentId: string; token: string },
): Promise<{ alreadyCanceled: boolean }> {
  const appointment = await deps.db.appointment.findUnique({ where: { id: input.appointmentId } });
  if (!appointment) throw Errors.notFound('No encontramos ese turno.');
  if (
    !verifyActionToken(deps.config.authCodeSecret, {
      appointmentId: appointment.id,
      action: 'cancel',
      startsAt: appointment.startsAt,
      token: input.token,
    })
  ) {
    throw Errors.forbidden('Ese link ya no sirve. Entrá a tu cuenta para cancelar el turno.');
  }
  if (appointment.status === 'CANCELED') return { alreadyCanceled: true };
  if (!(ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(appointment.status)) {
    throw Errors.conflict('Ese turno ya no se puede cancelar.');
  }

  const ids = await cancelInTx(deps, {
    appointmentId: appointment.id,
    from: appointment.status,
    actor: { type: 'CUSTOMER', customerId: appointment.customerId ?? undefined },
    reason: 'CUSTOMER_REQUEST',
    note: 'Canceló desde el recordatorio',
    notify: false,
  });
  await dispatchQueued(deps, ids);
  return { alreadyCanceled: false };
}
