import type { NotificationType, Tx } from '@estoicos/db';
import type { CoreConfig } from '../../deps';
import type { BookingEmailPayload } from './booking-emails';
import { queueNotification } from './outbox';

/**
 * Avisos de turnos (confirmación, reprogramación, cancelación y recordatorios). Arman la "foto"
 * del turno y la dejan en la bandeja de salida; el router decide después si sale por WhatsApp
 * o por email.
 */
export type BookingNotificationType = Extract<
  NotificationType,
  'BOOKING_CONFIRMATION' | 'BOOKING_RESCHEDULED' | 'BOOKING_CANCELLATION' | 'BOOKING_REMINDER'
>;

const appointmentInclude = {
  organization: { select: { name: true } },
  branch: { select: { name: true, address: true, city: true, slug: true, timezone: true } },
  barber: { select: { displayName: true } },
  customer: { select: { id: true, firstName: true } },
  services: { include: { service: { select: { name: true } } }, orderBy: { position: 'asc' as const } },
} as const;

/** Foto del turno con todo lo que necesitan los mensajes. */
export async function bookingPayload(
  tx: Tx,
  config: CoreConfig,
  appointmentId: string,
  previousStartsAt?: Date | null,
): Promise<{
  payload: BookingEmailPayload;
  customerId: string;
  branchId: string;
  organizationId: string;
} | null> {
  const a = await tx.appointment.findUniqueOrThrow({
    where: { id: appointmentId },
    include: appointmentInclude,
  });
  if (!a.customer) return null;
  return {
    customerId: a.customer.id,
    branchId: a.branchId,
    organizationId: a.organizationId,
    payload: {
      orgName: a.organization.name,
      customerFirstName: a.customer.firstName || 'cliente',
      branchName: a.branch.name,
      branchAddress: [a.branch.address, a.branch.city].filter(Boolean).join(', ') || null,
      barberName: a.barber.displayName,
      services: a.services.map((s) => s.service.name),
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      timezone: a.branch.timezone,
      totalCents: Number(a.bookedTotalCents),
      previousStartsAt: previousStartsAt?.toISOString() ?? null,
      manageUrl: `${config.appPublicUrl}/mi-cuenta/turnos`,
      bookingUrl: `${config.appPublicUrl}/reservar/${a.branch.slug}`,
    },
  };
}

/** Encola un aviso de turno. Devuelve el id a despachar, o null si no hay nada que mandar. */
export async function queueBookingNotification(
  tx: Tx,
  config: CoreConfig,
  input: {
    type: BookingNotificationType;
    appointmentId: string;
    dedupeKey: string;
    previousStartsAt?: Date | null;
  },
): Promise<string | null> {
  const data = await bookingPayload(tx, config, input.appointmentId, input.previousStartsAt);
  if (!data) return null;
  return queueNotification(tx, config, {
    type: input.type,
    dedupeKey: input.dedupeKey,
    customerId: data.customerId,
    organizationId: data.organizationId,
    branchId: data.branchId,
    appointmentId: input.appointmentId,
    payload: data.payload,
  });
}
