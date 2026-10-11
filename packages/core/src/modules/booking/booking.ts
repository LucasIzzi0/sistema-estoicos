import type { ActorType, AppointmentSource, AppointmentStatus, Tx } from '@estoicos/db';
import { ACTIVE_APPOINTMENT_STATUSES, addDays, instantToLocal, todayIn } from '@estoicos/shared';
import type { CoreDeps } from '../../deps';
import { DomainError, Errors, isSlotConflict } from '../../errors';
import { localToInstant } from '../../time';
import { queueBookingNotification } from '../notifications/booking-notifications';
import {
  barberSlots,
  bookedMinutesWithin,
  overlaps,
  rankBarbersForAnyChoice,
  scheduleProblem,
  type DayInput,
  type ScheduleProblem,
} from './availability';
import { loadDays, type BranchRef, type EligibleBarber, type ResolvedService } from './booking-data';

/**
 * Reservar sin doble reserva (decisión D6), en dos capas:
 *  1. Lock por barbero (pg_advisory_xact_lock) → se revalida TODO dentro de la transacción → insert.
 *  2. La restricción EXCLUDE de la base, garantía final aunque haya un bug en la app.
 * Si además hay cliente, primero se toma su lock (orden fijo cliente → barbero: sin deadlocks),
 * así dos pedidos simultáneos del mismo cliente no superan el máximo de turnos activos.
 */
export type BookingMode =
  /** Reserva online: el horario tiene que ser uno de los ofrecidos (anticipación, paso, horario). */
  | 'online'
  /** Staff: cualquier hora; fuera del horario pide confirmación (force). Nunca pisa otro turno. */
  | 'staff'
  /** Atención sin turno: empieza ahora, solo se valida que el barbero esté libre. */
  | 'walk-in';

export interface BookingRules {
  stepMinutes: number;
  minNoticeMinutes: number;
  maxDaysAhead: number;
  maxActivePerCustomer: number;
}

export async function loadBookingRules(client: Pick<Tx, 'organizationSettings'>, organizationId: string) {
  const s = await client.organizationSettings.findUnique({ where: { organizationId } });
  return {
    stepMinutes: s?.bookingSlotStepMinutes ?? 15,
    minNoticeMinutes: s?.bookingMinNoticeMinutes ?? 60,
    maxDaysAhead: s?.bookingMaxDaysAhead ?? 30,
    maxActivePerCustomer: s?.bookingMaxActivePerCustomer ?? 2,
    allowAnyBarber: s?.bookingAllowAnyBarber ?? true,
    customerCanReschedule: s?.customerCanReschedule ?? true,
    rescheduleMinNoticeHours: s?.customerRescheduleMinNoticeHours ?? 3,
  };
}
export type OrgBookingRules = Awaited<ReturnType<typeof loadBookingRules>>;

/** Límites de la reserva online: desde ahora + anticipación mínima hasta el fin del día N. */
export function onlineWindow(rules: BookingRules, timezone: string, now: Date) {
  const lastDate = addDays(todayIn(timezone, now), rules.maxDaysAhead);
  return {
    notBefore: new Date(now.getTime() + rules.minNoticeMinutes * 60_000),
    notAfter: localToInstant(lastDate, 24 * 60, timezone),
    lastDate,
  };
}

export class OutsideScheduleError extends DomainError {
  constructor(problem: ScheduleProblem) {
    const messages: Record<ScheduleProblem, string> = {
      OUTSIDE_SCHEDULE: 'Ese horario está fuera del horario de trabajo del barbero.',
      TIME_OFF: 'El barbero tiene un bloqueo en ese horario.',
      CLOSURE: 'La sucursal está cerrada ese día (feriado o cierre).',
    };
    super('OUTSIDE_SCHEDULE', `${messages[problem]} ¿Querés agendarlo igual?`, 409, { problem });
  }
}

async function lockKeys(tx: Tx, keys: string[]) {
  for (const key of keys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }
}

/**
 * Corre `fn` en una transacción con los locks del cliente y del barbero. Traduce el choque
 * con la restricción de la base (o un deadlock) a "ese horario ya no está disponible".
 */
export async function withBookingLocks<T>(
  deps: CoreDeps,
  keys: { customerId?: string | null; barberId: string },
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  try {
    return await deps.db.$transaction(
      async (tx) => {
        await lockKeys(tx, [
          ...(keys.customerId ? [`customer:${keys.customerId}`] : []),
          `barber:${keys.barberId}`,
        ]);
        return fn(tx);
      },
      { maxWait: 5_000, timeout: 15_000 },
    );
  } catch (error) {
    if (isSlotConflict(error)) throw Errors.slotTaken();
    throw error;
  }
}

export interface SlotCheck {
  branch: BranchRef;
  barber: EligibleBarber;
  startsAt: Date;
  mode: BookingMode;
  rules: BookingRules;
  force?: boolean;
  excludeAppointmentId?: string | undefined;
  now: Date;
}

/** Revalida el horario DENTRO de la transacción (con el lock del barbero ya tomado). */
export async function assertSlotFree(tx: Tx, check: SlotCheck): Promise<{ endsAt: Date }> {
  const { branch, barber, startsAt, mode } = check;
  const endsAt = new Date(startsAt.getTime() + barber.durationMin * 60_000);
  const { date, minute } = instantToLocal(startsAt, branch.timezone);
  const [day] = await loadDays(tx, {
    branch,
    barberIds: [barber.id],
    from: date,
    to: date,
    excludeAppointmentId: check.excludeAppointmentId,
  });
  const data = day!.barbers.get(barber.id)!;
  const dayInput: DayInput = {
    date,
    timezone: branch.timezone,
    stepMinutes: check.rules.stepMinutes,
    closures: day!.closures,
  };

  if (mode === 'online') {
    const window = onlineWindow(check.rules, branch.timezone, check.now);
    const slots = barberSlots(
      { ...dayInput, notBefore: window.notBefore, notAfter: window.notAfter },
      {
        barberId: barber.id,
        intervals: data.intervals,
        busy: [...data.appointments, ...data.timeOffs],
        durationMin: barber.durationMin,
      },
    );
    if (!slots.some((s) => s.minute === minute && s.startsAt.getTime() === startsAt.getTime())) {
      throw Errors.slotTaken();
    }
    return { endsAt };
  }

  // Staff y sin turno: nunca se pisa otro turno.
  if (data.appointments.some((a) => overlaps(a, { startsAt, endsAt }))) {
    throw new DomainError(
      'SLOT_TAKEN',
      `${barber.displayName} ya tiene un turno que se pisa con ese horario.`,
      409,
    );
  }
  if (mode === 'staff' && !check.force) {
    const problem = scheduleProblem(dayInput, data.intervals, data.timeOffs, { startsAt, endsAt });
    if (problem) throw new OutsideScheduleError(problem);
  }
  return { endsAt };
}

/** Turnos activos a futuro del cliente (máximo configurable, P15: 2). */
export async function assertCustomerCanBook(
  tx: Tx,
  input: { customerId: string; max: number; now: Date; excludeAppointmentId?: string },
) {
  const active = await tx.appointment.count({
    where: {
      customerId: input.customerId,
      status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
      startsAt: { gt: input.now },
      ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}),
    },
  });
  if (active >= input.max) {
    throw new DomainError(
      'TOO_MANY_ACTIVE',
      `Ya tenés ${active} ${active === 1 ? 'turno reservado' : 'turnos reservados'}. Para reservar otro, cancelá o esperá a que pase alguno.`,
      409,
    );
  }
}

/**
 * Orden de prueba de barberos para un horario. Con barbero elegido, solo ese. Con "cualquiera"
 * (P14): los que estarían libres, del que tiene menos minutos reservados ese día al que más.
 */
export async function candidateOrder(
  deps: CoreDeps,
  input: {
    branch: BranchRef;
    barbers: EligibleBarber[];
    startsAt: Date;
    rules: BookingRules;
    mode: BookingMode;
    excludeAppointmentId?: string | undefined;
  },
): Promise<EligibleBarber[]> {
  if (input.barbers.length <= 1) return input.barbers;
  const { date, minute } = instantToLocal(input.startsAt, input.branch.timezone);
  const [day] = await loadDays(deps.db, {
    branch: input.branch,
    barberIds: input.barbers.map((b) => b.id),
    from: date,
    to: date,
    excludeAppointmentId: input.excludeAppointmentId,
  });
  const dayInput: DayInput = {
    date,
    timezone: input.branch.timezone,
    stepMinutes: input.rules.stepMinutes,
    closures: day!.closures,
  };
  const free = input.barbers.filter((b) => {
    const data = day!.barbers.get(b.id)!;
    return barberSlots(dayInput, {
      barberId: b.id,
      intervals: data.intervals,
      busy: [...data.appointments, ...data.timeOffs],
      durationMin: b.durationMin,
    }).some((s) => s.minute === minute);
  });
  if (!free.length) throw Errors.slotTaken();
  const ranked = rankBarbersForAnyChoice(
    free.map((b) => ({
      barberId: b.id,
      name: b.displayName,
      sortOrder: b.sortOrder,
      bookedMinutes: bookedMinutesWithin(day!.barbers.get(b.id)!.appointments, day!.window),
    })),
  );
  return ranked.map((id) => free.find((b) => b.id === id)!);
}

export interface Actor {
  type: ActorType;
  userId?: string | null;
  customerId?: string | null;
}

export interface CreateInput {
  branch: BranchRef;
  services: ResolvedService[];
  /** Candidatos en orden (uno solo si el barbero se eligió). */
  candidates: EligibleBarber[];
  anyBarberRequested: boolean;
  customerId: string | null;
  startsAt: Date;
  mode: BookingMode;
  rules: BookingRules;
  force?: boolean;
  source: AppointmentSource;
  status: Extract<AppointmentStatus, 'BOOKED' | 'IN_PROGRESS'>;
  actor: Actor;
  customerNotes?: string | null;
  internalNotes?: string | null;
  /** Máximo de turnos activos a validar (solo reserva online). */
  maxActive?: number;
  notify: boolean;
}

/**
 * Crea el turno. Con "cualquier barbero", si el primero se ocupa justo en ese instante, prueba
 * con el siguiente candidato. Devuelve el id y las notificaciones a despachar.
 */
export async function createBooking(
  deps: CoreDeps,
  input: CreateInput,
): Promise<{ appointmentId: string; notificationIds: (string | null)[] }> {
  const now = deps.now();
  let lastError: unknown = Errors.slotTaken();
  for (const barber of input.candidates.slice(0, 5)) {
    try {
      return await withBookingLocks(
        deps,
        { customerId: input.customerId, barberId: barber.id },
        async (tx) => {
          if (input.customerId && input.maxActive) {
            await assertCustomerCanBook(tx, { customerId: input.customerId, max: input.maxActive, now });
          }
          const { endsAt } = await assertSlotFree(tx, {
            branch: input.branch,
            barber,
            startsAt: input.startsAt,
            mode: input.mode,
            rules: input.rules,
            force: input.force,
            now,
          });
          const total = input.services.reduce((a, s) => a + s.priceCents, 0n);
          const appointment = await tx.appointment.create({
            data: {
              organizationId: input.branch.organizationId,
              branchId: input.branch.id,
              barberId: barber.id,
              customerId: input.customerId,
              status: input.status,
              source: input.source,
              startsAt: input.startsAt,
              endsAt,
              anyBarberRequested: input.anyBarberRequested,
              customerNotes: input.customerNotes ?? null,
              internalNotes: input.internalNotes ?? null,
              bookedTotalCents: total,
              startedAt: input.status === 'IN_PROGRESS' ? now : null,
              createdById: input.actor.userId ?? null,
              services: {
                create: input.services.map((s, i) => ({
                  serviceId: s.id,
                  position: i,
                  durationMin: barber.durations[i]!,
                  priceCents: s.priceCents,
                })),
              },
              events: {
                create: {
                  type: 'CREATED',
                  toStatus: input.status,
                  actorType: input.actor.type,
                  actorUserId: input.actor.userId ?? null,
                  actorCustomerId: input.actor.customerId ?? null,
                },
              },
            },
          });
          const notificationIds =
            input.notify && input.customerId
              ? [
                  await queueBookingNotification(tx, deps.config, {
                    type: 'BOOKING_CONFIRMATION',
                    appointmentId: appointment.id,
                    dedupeKey: `confirm:${appointment.id}`,
                  }),
                ]
              : [];
          return { appointmentId: appointment.id, notificationIds };
        },
      );
    } catch (error) {
      lastError = error;
      if (!(error instanceof DomainError && error.code === 'SLOT_TAKEN' && input.anyBarberRequested))
        throw error;
    }
  }
  throw lastError;
}

export interface RelocateInput {
  appointmentId: string;
  branch: BranchRef;
  barber: EligibleBarber;
  startsAt: Date;
  /** Si cambian los servicios: la lista nueva (los que ya estaban conservan su precio reservado). */
  services?: ResolvedService[];
  mode: BookingMode;
  rules: BookingRules;
  force?: boolean;
  actor: Actor;
  customerId: string | null;
  /** Solo reprogramación online: se vuelve a validar el máximo (sin contar este turno). */
  maxActive?: number;
  internalNotes?: string | null | undefined;
  notify: boolean;
}

/** Mover un turno (día, hora, barbero) o cambiarle servicios: mismo camino con lock y revalidación. */
export async function relocateBooking(
  deps: CoreDeps,
  input: RelocateInput,
): Promise<{ notificationIds: (string | null)[] }> {
  const now = deps.now();
  return withBookingLocks(deps, { customerId: input.customerId, barberId: input.barber.id }, async (tx) => {
    const current = await tx.appointment.findUniqueOrThrow({
      where: { id: input.appointmentId },
      include: { services: { orderBy: { position: 'asc' } } },
    });
    if (!['BOOKED', 'CONFIRMED', 'IN_PROGRESS'].includes(current.status)) {
      throw Errors.conflict('Este turno ya no se puede modificar.');
    }
    if (input.customerId && input.maxActive) {
      await assertCustomerCanBook(tx, {
        customerId: input.customerId,
        max: input.maxActive,
        now,
        excludeAppointmentId: current.id,
      });
    }

    // La duración sale de los servicios (nuevos o actuales) con el override del barbero destino.
    const serviceRows = input.services
      ? input.services.map((s, i) => ({
          serviceId: s.id,
          position: i,
          durationMin: input.barber.durations[i]!,
          priceCents: current.services.find((c) => c.serviceId === s.id)?.priceCents ?? s.priceCents,
        }))
      : // Sin cambio de servicios, la duración y el precio quedan como se reservaron.
        current.services.map((c, i) => ({
          serviceId: c.serviceId,
          position: i,
          durationMin: c.durationMin,
          priceCents: c.priceCents,
        }));
    const barber = { ...input.barber, durationMin: serviceRows.reduce((a, s) => a + s.durationMin, 0) };

    const { endsAt } = await assertSlotFree(tx, {
      branch: input.branch,
      barber,
      startsAt: input.startsAt,
      mode: input.mode,
      rules: input.rules,
      force: input.force,
      excludeAppointmentId: current.id,
      now,
    });

    const timeChanged = current.startsAt.getTime() !== input.startsAt.getTime();
    const barberChanged = current.barberId !== barber.id;
    const servicesChanged =
      !!input.services &&
      (input.services.length !== current.services.length ||
        input.services.some((s, i) => current.services[i]?.serviceId !== s.id));

    if (servicesChanged) {
      await tx.appointmentService.deleteMany({ where: { appointmentId: current.id } });
      await tx.appointmentService.createMany({
        data: serviceRows.map((s) => ({ ...s, appointmentId: current.id })),
      });
    }
    await tx.appointment.update({
      where: { id: current.id },
      data: {
        barberId: barber.id,
        startsAt: input.startsAt,
        endsAt,
        ...(servicesChanged ? { bookedTotalCents: serviceRows.reduce((a, s) => a + s.priceCents, 0n) } : {}),
        ...(input.internalNotes !== undefined ? { internalNotes: input.internalNotes } : {}),
      },
    });

    const actor = {
      actorType: input.actor.type,
      actorUserId: input.actor.userId ?? null,
      actorCustomerId: input.actor.customerId ?? null,
    };
    let rescheduleEventId: string | null = null;
    if (timeChanged) {
      const event = await tx.appointmentEvent.create({
        data: {
          appointmentId: current.id,
          type: 'RESCHEDULED',
          previousStartsAt: current.startsAt,
          ...actor,
        },
      });
      rescheduleEventId = event.id;
    }
    if (barberChanged) {
      await tx.appointmentEvent.create({
        data: { appointmentId: current.id, type: 'REASSIGNED', previousBarberId: current.barberId, ...actor },
      });
    }
    if (servicesChanged) {
      await tx.appointmentEvent.create({
        data: { appointmentId: current.id, type: 'UPDATED', note: 'Cambio de servicios', ...actor },
      });
    }

    const notificationIds: (string | null)[] = [];
    if (input.notify && current.customerId && (timeChanged || barberChanged) && input.startsAt > now) {
      notificationIds.push(
        await queueBookingNotification(tx, deps.config, {
          type: 'BOOKING_RESCHEDULED',
          appointmentId: current.id,
          dedupeKey: `reschedule:${current.id}:${rescheduleEventId ?? `${barber.id}:${input.startsAt.toISOString()}`}`,
          previousStartsAt: current.startsAt,
        }),
      );
    }
    return { notificationIds };
  });
}
