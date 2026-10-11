import type { Appointment, Db, Tx } from '@estoicos/db';
import { MercadoPagoError } from '@estoicos/integrations';
import type { CoreDeps } from '../../deps';
import { DomainError } from '../../errors';
import { raiseAlert } from '../system/system';
import { findActiveAccount, mpClientFor } from './account';

/**
 * Seña online con Checkout Pro (docs/fase-0/01-arquitectura.md §9.7).
 *
 * **Apagada por decisión del fundador (28/09/2026):** los servicios arrancan con `depositMode
 * NONE`, así que hoy nadie paga seña. El circuito queda completo y probado para prenderlo desde
 * configuración sin tocar código.
 */
export interface DepositRule {
  mode: 'NONE' | 'FIXED' | 'PERCENT';
  fixedCents: bigint | null;
  percentBps: number | null;
}

/** Cuánta seña corresponde por los servicios elegidos (0 = no se pide seña). */
export function depositFor(
  services: { priceCents: bigint; deposit: DepositRule }[],
  options: { forceBps?: number | null } = {},
): bigint {
  let total = 0n;
  for (const service of services) {
    const { mode, fixedCents, percentBps } = service.deposit;
    if (mode === 'FIXED' && fixedCents) total += fixedCents;
    else if (mode === 'PERCENT' && percentBps) total += (service.priceCents * BigInt(percentBps)) / 10_000n;
  }
  // Cliente con ausencias: se le pide seña aunque el servicio no la exija (P17).
  if (total === 0n && options.forceBps) {
    const full = services.reduce((a, s) => a + s.priceCents, 0n);
    total = (full * BigInt(options.forceBps)) / 10_000n;
  }
  return total;
}

/**
 * ¿Este cliente tiene que dejar seña igual? Pasa cuando acumuló ausencias y la configuración
 * tiene un umbral (`noShowDepositThreshold`). Devuelve el % a pedir, o null.
 */
export async function noShowDepositBps(
  deps: CoreDeps,
  organizationId: string,
  customerId: string | null,
): Promise<number | null> {
  if (!customerId) return null;
  const settings = await deps.db.organizationSettings.findUnique({ where: { organizationId } });
  const threshold = settings?.noShowDepositThreshold;
  if (!threshold) return null;
  const noShows = await deps.db.appointment.count({ where: { customerId, status: 'NO_SHOW' } });
  return noShows >= threshold ? (settings?.noShowDepositPercentBps ?? 5000) : null;
}

/**
 * Crea el cobro pendiente de la seña y su preferencia de pago. El turno queda
 * PENDING_PAYMENT y **ocupa el horario** hasta `holdExpiresAt`; si no paga, un job lo libera.
 */
export async function createDepositCheckout(
  deps: CoreDeps,
  input: {
    appointment: Appointment;
    amountCents: bigint;
    payerEmail?: string | undefined;
    branchSlug: string;
  },
): Promise<{ initPoint: string; paymentId: string }> {
  const account = await findActiveAccount(deps, input.appointment.organizationId);
  if (!account || account.status !== 'ACTIVE') {
    throw new DomainError(
      'MP_NOT_CONNECTED',
      'No podemos cobrar la seña ahora. Probá reservar sin seña o escribinos.',
      409,
    );
  }
  const expiresAt = input.appointment.holdExpiresAt ?? new Date(deps.now().getTime() + 15 * 60_000);

  const payment = await deps.db.payment.create({
    data: {
      organizationId: input.appointment.organizationId,
      branchId: input.appointment.branchId,
      purpose: 'DEPOSIT',
      method: 'MP_CHECKOUT',
      status: 'PENDING',
      amountCents: input.amountCents,
      appointmentId: input.appointment.id,
      customerId: input.appointment.customerId,
    },
  });

  try {
    const preference = await mpClientFor(deps, account).createPreference({
      title: 'Seña de tu turno',
      amount: (Number(input.amountCents) / 100).toFixed(2),
      externalReference: `dep_${payment.id}`,
      payerEmail: input.payerEmail,
      expiresAt,
      backUrl: `${deps.config.appPublicUrl}/reservar/${input.branchSlug}/pago`,
    });
    await deps.db.mpPreference.create({
      data: {
        mpAccountId: account.id,
        appointmentId: input.appointment.id,
        paymentId: payment.id,
        externalId: preference.id,
        initPoint: preference.init_point,
        externalReference: `dep_${payment.id}`,
        expiresAt,
      },
    });
    return { initPoint: preference.init_point, paymentId: payment.id };
  } catch (error) {
    await deps.db.payment.delete({ where: { id: payment.id } }).catch(() => undefined);
    const message = error instanceof MercadoPagoError ? error.message : String(error);
    throw new DomainError('MP_UNAVAILABLE', `No pudimos generar el pago de la seña: ${message}`, 503);
  }
}

/**
 * Seña pagada: el turno pasa a CONFIRMADO. Si el turno ya se liberó y el horario sigue libre,
 * se reactiva; si no, la plata queda como saldo a favor y se avisa al admin (§9.7).
 */
export async function applyPaidDeposit(deps: CoreDeps, paymentId: string): Promise<'CONFIRMED' | 'CREDITED'> {
  const now = deps.now();
  return deps.db.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({
      where: { id: paymentId },
      include: { appointment: true },
    });
    if (payment.status === 'APPROVED' && payment.appointment?.depositStatus === 'PAID') return 'CONFIRMED';
    await tx.payment.updateMany({
      where: { id: paymentId, status: 'PENDING' },
      data: { status: 'APPROVED', approvedAt: now },
    });
    const appointment = payment.appointment;

    const revivable =
      appointment &&
      (['PENDING_PAYMENT', 'BOOKED', 'CONFIRMED'].includes(appointment.status) ||
        (appointment.status === 'CANCELED' && (await slotStillFree(tx, appointment))));
    if (appointment && revivable) {
      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          status: 'CONFIRMED',
          confirmedAt: now,
          confirmedVia: 'DEPOSIT_PAID',
          depositStatus: 'PAID',
          holdExpiresAt: null,
          ...(appointment.status === 'CANCELED'
            ? { canceledAt: null, canceledBy: null, cancelReason: null, cancelNote: null }
            : {}),
        },
      });
      await tx.appointmentEvent.create({
        data: {
          appointmentId: appointment.id,
          type: 'STATUS_CHANGED',
          fromStatus: appointment.status,
          toStatus: 'CONFIRMED',
          actorType: 'SYSTEM',
          note: 'Seña pagada',
        },
      });
      return 'CONFIRMED';
    }

    // Llegó tarde y el horario ya no está: la plata no se pierde.
    if (payment.customerId) {
      await tx.customerCreditEntry.create({
        data: {
          organizationId: payment.organizationId,
          customerId: payment.customerId,
          branchId: payment.branchId,
          type: 'TOPUP',
          amountCents: payment.amountCents,
          paymentId: payment.id,
          reason: 'Seña pagada fuera de término',
          idempotencyKey: `late-deposit:${payment.id}`,
        },
      });
    }
    await raiseAlert(
      tx as unknown as Db,
      {
        organizationId: payment.organizationId,
        kind: 'LATE_DEPOSIT_PAYMENT',
        severity: 'WARNING',
        dedupeKey: `late-deposit:${payment.id}`,
        message: 'Una seña se pagó tarde: el turno ya no estaba y la plata quedó como saldo a favor.',
        details: { paymentId: payment.id, appointmentId: payment.appointmentId },
      },
      now,
    );
    return 'CREDITED';
  });
}

async function slotStillFree(tx: Tx, appointment: Appointment): Promise<boolean> {
  const clash = await tx.appointment.count({
    where: {
      barberId: appointment.barberId,
      status: { in: ['PENDING_PAYMENT', 'BOOKED', 'CONFIRMED', 'IN_PROGRESS'] },
      startsAt: { lt: appointment.endsAt },
      endsAt: { gt: appointment.startsAt },
      id: { not: appointment.id },
    },
  });
  return clash === 0;
}

/** Turnos con la seña impaga cuyo plazo venció: el job los libera. */
export async function findExpiredDepositHolds(deps: CoreDeps, limit = 100) {
  return deps.db.appointment.findMany({
    where: { status: 'PENDING_PAYMENT', holdExpiresAt: { lt: deps.now() } },
    select: { id: true },
    take: limit,
  });
}

/** Libera un turno que nunca pagó la seña. */
export async function releaseUnpaidHold(deps: CoreDeps, appointmentId: string): Promise<boolean> {
  const now = deps.now();
  return deps.db.$transaction(async (tx) => {
    const updated = await tx.appointment.updateMany({
      where: { id: appointmentId, status: 'PENDING_PAYMENT', holdExpiresAt: { lt: now } },
      data: {
        status: 'CANCELED',
        canceledAt: now,
        canceledBy: 'SYSTEM',
        cancelReason: 'PAYMENT_TIMEOUT',
        depositStatus: 'EXPIRED',
      },
    });
    if (updated.count === 0) return false;
    await tx.appointmentEvent.create({
      data: {
        appointmentId,
        type: 'STATUS_CHANGED',
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CANCELED',
        actorType: 'SYSTEM',
        note: 'No se pagó la seña a tiempo',
      },
    });
    await tx.payment.updateMany({
      where: { appointmentId, purpose: 'DEPOSIT', status: 'PENDING' },
      data: { status: 'EXPIRED' },
    });
    return true;
  });
}
