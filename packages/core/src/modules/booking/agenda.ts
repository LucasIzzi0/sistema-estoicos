import type { AppointmentStatus, Prisma } from '@estoicos/db';
import {
  addDays,
  agendaQuery,
  appointmentStatusBody,
  availabilityQuery,
  cancelAppointmentBody,
  createAppointmentBody,
  instantToLocal,
  timeToMinutes,
  updateAppointmentBody,
  walkInBody,
  type Agenda,
  type AgendaAppointment,
  type AppointmentDetail,
  type AppointmentStatusBody,
  type Availability,
  type AvailabilityQuery,
  type CancelAppointmentBody,
  type CreateAppointmentBody,
  type UpdateAppointmentBody,
  type WalkInBody,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors } from '../../errors';
import { localToInstant } from '../../time';
import { writeAudit } from '../audit/audit';
import { queueBookingNotification } from '../notifications/booking-notifications';
import { dispatchQueued } from '../notifications/outbox';
import {
  branchRefSelect,
  eligibleBarbers,
  loadDays,
  resolveServices,
  type BranchRef,
  type ResolvedService,
} from './booking-data';
import { createBooking, loadBookingRules, relocateBooking, withBookingLocks } from './booking';
import { computeAvailability } from './slots';

/**
 * Agenda del panel. La operan el dueño, el encargado y recepción (los barberos no tienen
 * acceso, decisión del 25/09/2026). Cada acción valida el permiso Y la sucursal del turno.
 */
async function loadBranch(deps: CoreDeps, p: StaffPrincipal, branchId: string): Promise<BranchRef> {
  requireBranchAccess(p, branchId);
  const branch = await deps.db.branch.findFirst({
    where: { id: branchId, organizationId: p.organizationId },
    select: branchRefSelect,
  });
  if (!branch) throw Errors.notFound('No encontramos esa sucursal.');
  return branch;
}

const appointmentInclude = {
  customer: { select: { id: true, firstName: true, lastName: true, phone: true, email: true } },
  services: { include: { service: { select: { name: true } } }, orderBy: { position: 'asc' } },
} as const satisfies Prisma.AppointmentInclude;
type AppointmentRow = Prisma.AppointmentGetPayload<{ include: typeof appointmentInclude }>;

function customerName(c: AppointmentRow['customer']): string | null {
  if (!c) return null;
  return `${c.firstName} ${c.lastName}`.trim() || c.email || 'Cliente';
}

function toAgendaAppointment(a: AppointmentRow, noShows: Map<string, number>): AgendaAppointment {
  return {
    id: a.id,
    barberId: a.barberId,
    customerId: a.customerId,
    customerName: customerName(a.customer),
    customerPhone: a.customer?.phone ?? null,
    customerNoShows: a.customerId ? (noShows.get(a.customerId) ?? 0) : 0,
    status: a.status,
    source: a.source,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    services: a.services.map((s) => ({
      serviceId: s.serviceId,
      name: s.service.name,
      durationMin: s.durationMin,
      priceCents: Number(s.priceCents),
    })),
    bookedTotalCents: Number(a.bookedTotalCents),
    anyBarberRequested: a.anyBarberRequested,
    customerNotes: a.customerNotes,
    internalNotes: a.internalNotes,
  };
}

async function noShowCounts(deps: CoreDeps, customerIds: (string | null)[]): Promise<Map<string, number>> {
  const ids = [...new Set(customerIds.filter((id): id is string => !!id))];
  if (!ids.length) return new Map();
  const rows = await deps.db.appointment.groupBy({
    by: ['customerId'],
    where: { customerId: { in: ids }, status: 'NO_SHOW' },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.customerId!, r._count._all]));
}

export async function getAgenda(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  rawQuery: z.input<typeof agendaQuery>,
): Promise<Agenda> {
  requirePermission(p, 'agenda:read');
  const query = agendaQuery.parse(rawQuery);
  const branch = await loadBranch(deps, p, branchId);
  const to = addDays(query.date, query.days - 1);
  const rangeStart = localToInstant(query.date, 0, branch.timezone);
  const rangeEnd = localToInstant(to, 24 * 60, branch.timezone);

  const appointments = await deps.db.appointment.findMany({
    where: {
      branchId,
      status: { not: 'CANCELED' },
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
      ...(query.barberId ? { barberId: query.barberId } : {}),
    },
    include: appointmentInclude,
    orderBy: { startsAt: 'asc' },
  });

  // Columnas: barberos activos de la sucursal + los que tengan turnos ahí (aunque ya no estén).
  const barbers = await deps.db.barber.findMany({
    where: {
      organizationId: p.organizationId,
      ...(query.barberId ? { id: query.barberId } : {}),
      OR: [
        { active: true, branches: { some: { branchId, active: true } } },
        { id: { in: appointments.map((a) => a.barberId) } },
      ],
    },
    select: { id: true, displayName: true, color: true },
    orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
  });
  const barberIds = barbers.map((b) => b.id);

  const [days, timeOffs, closures, noShows] = await Promise.all([
    loadDays(deps.db, { branch, barberIds, from: query.date, to }),
    deps.db.barberTimeOff.findMany({
      where: {
        barberId: { in: barberIds },
        OR: [{ branchId: null }, { branchId }],
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
      },
      orderBy: { startsAt: 'asc' },
    }),
    deps.db.branchClosure.findMany({
      where: { branchId, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
    }),
    noShowCounts(
      deps,
      appointments.map((a) => a.customerId),
    ),
  ]);

  return {
    branchId,
    timezone: branch.timezone,
    from: query.date,
    days: query.days,
    barbers: barbers.map((b) => ({
      ...b,
      workingHours: days.flatMap((d) =>
        (d.barbers.get(b.id)?.intervals ?? []).map((i) => ({ date: d.date, ...i })),
      ),
    })),
    timeOffs: timeOffs.map((t) => ({
      id: t.id,
      barberId: t.barberId,
      startsAt: t.startsAt.toISOString(),
      endsAt: t.endsAt.toISOString(),
      type: t.type,
      note: t.note,
    })),
    closures: closures.map((c) => ({
      id: c.id,
      startsAt: c.startsAt.toISOString(),
      endsAt: c.endsAt.toISOString(),
      reason: c.reason,
    })),
    appointments: appointments.map((a) => toAgendaAppointment(a, noShows)),
  };
}

/** Horarios libres para el panel: incluye servicios y barberos que no se reservan online. */
export async function getStaffAvailability(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  rawQuery: AvailabilityQuery,
): Promise<Availability> {
  requirePermission(p, 'agenda:read');
  const query = availabilityQuery.parse(rawQuery);
  const branch = await loadBranch(deps, p, branchId);
  const rules = await loadBookingRules(deps.db, p.organizationId);
  const services = await resolveServices(deps.db, {
    organizationId: p.organizationId,
    branchId,
    serviceIds: query.serviceIds,
    onlineOnly: false,
  });
  const barbers = await eligibleBarbers(deps.db, {
    organizationId: p.organizationId,
    branchId,
    services,
    onlineOnly: false,
    ...(query.barberId ? { barberIds: [query.barberId] } : {}),
  });
  return computeAvailability(deps, {
    branch,
    barbers,
    from: query.from,
    days: query.days,
    stepMinutes: rules.stepMinutes,
    notBefore: deps.now(),
    excludeAppointmentId: query.excludeAppointmentId,
  });
}

async function loadAppointmentForStaff(deps: CoreDeps, p: StaffPrincipal, appointmentId: string) {
  const a = await deps.db.appointment.findFirst({
    where: { id: appointmentId, organizationId: p.organizationId },
    include: appointmentInclude,
  });
  if (!a) throw Errors.notFound('No encontramos ese turno.');
  requireBranchAccess(p, a.branchId);
  return a;
}

export async function getAppointmentDetail(
  deps: CoreDeps,
  p: StaffPrincipal,
  appointmentId: string,
): Promise<AppointmentDetail> {
  requirePermission(p, 'agenda:read');
  const a = await loadAppointmentForStaff(deps, p, appointmentId);
  const [barber, events, noShows] = await Promise.all([
    deps.db.barber.findUniqueOrThrow({ where: { id: a.barberId }, select: { displayName: true } }),
    deps.db.appointmentEvent.findMany({
      where: { appointmentId },
      include: { actorUser: { select: { name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    noShowCounts(deps, [a.customerId]),
  ]);
  return {
    ...toAgendaAppointment(a, noShows),
    branchId: a.branchId,
    barberName: barber.displayName,
    customerEmail: a.customer?.email ?? null,
    createdAt: a.createdAt.toISOString(),
    cancelReason: a.cancelReason,
    cancelNote: a.cancelNote,
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      fromStatus: e.fromStatus,
      toStatus: e.toStatus,
      previousStartsAt: e.previousStartsAt?.toISOString() ?? null,
      actor:
        e.actorType === 'CUSTOMER'
          ? 'El cliente (online)'
          : e.actorType === 'SYSTEM'
            ? 'Sistema'
            : (e.actorUser?.name ?? 'Staff'),
      note: e.note,
      createdAt: e.createdAt.toISOString(),
    })),
  };
}

async function requireCustomer(deps: CoreDeps, organizationId: string, customerId: string) {
  const customer = await deps.db.customer.findFirst({
    where: { id: customerId, organizationId, anonymizedAt: null, mergedIntoId: null },
    select: { id: true },
  });
  if (!customer) throw Errors.invalid('No encontramos ese cliente.');
}

async function staffBarber(deps: CoreDeps, branch: BranchRef, services: ResolvedService[], barberId: string) {
  const [barber] = await eligibleBarbers(deps.db, {
    organizationId: branch.organizationId,
    branchId: branch.id,
    services,
    onlineOnly: false,
    barberIds: [barberId],
  });
  if (!barber) {
    throw Errors.invalid(
      'Ese barbero no hace alguno de los servicios elegidos o no trabaja en esta sucursal.',
    );
  }
  return barber;
}

function staffActor(p: StaffPrincipal) {
  return { type: 'STAFF' as const, userId: p.userId };
}

/** Turno cargado desde el panel (teléfono, mostrador). Le llega la confirmación al cliente. */
export async function createStaffAppointment(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  rawBody: CreateAppointmentBody,
): Promise<AppointmentDetail> {
  requirePermission(p, 'appointments:manage');
  const body = createAppointmentBody.parse(rawBody);
  const branch = await loadBranch(deps, p, branchId);
  await requireCustomer(deps, p.organizationId, body.customerId);
  const services = await resolveServices(deps.db, {
    organizationId: p.organizationId,
    branchId,
    serviceIds: body.serviceIds,
    onlineOnly: false,
  });
  const barber = await staffBarber(deps, branch, services, body.barberId);
  const startsAt = localToInstant(body.date, timeToMinutes(body.time)!, branch.timezone);
  if (startsAt < new Date(deps.now().getTime() - 60 * 60_000)) {
    throw Errors.invalid('Ese horario ya pasó.');
  }
  const rules = await loadBookingRules(deps.db, p.organizationId);
  const result = await createBooking(deps, {
    branch,
    services,
    candidates: [barber],
    anyBarberRequested: false,
    customerId: body.customerId,
    startsAt,
    mode: 'staff',
    rules,
    force: body.force,
    source: 'STAFF',
    status: 'BOOKED',
    actor: staffActor(p),
    internalNotes: body.internalNotes,
    notify: true,
  });
  await dispatchQueued(deps, result.notificationIds);
  return getAppointmentDetail(deps, p, result.appointmentId);
}

/** Atención sin turno: queda "en curso" desde ahora y ocupa la agenda del barbero. */
export async function createWalkIn(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  rawBody: WalkInBody,
): Promise<AppointmentDetail> {
  requirePermission(p, 'appointments:manage');
  const body = walkInBody.parse(rawBody);
  const branch = await loadBranch(deps, p, branchId);
  if (body.customerId) await requireCustomer(deps, p.organizationId, body.customerId);
  const services = await resolveServices(deps.db, {
    organizationId: p.organizationId,
    branchId,
    serviceIds: body.serviceIds,
    onlineOnly: false,
  });
  const barber = await staffBarber(deps, branch, services, body.barberId);
  const now = deps.now();
  const startsAt = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const rules = await loadBookingRules(deps.db, p.organizationId);
  const result = await createBooking(deps, {
    branch,
    services,
    candidates: [barber],
    anyBarberRequested: false,
    customerId: body.customerId ?? null,
    startsAt,
    mode: 'walk-in',
    rules,
    source: 'WALK_IN',
    status: 'IN_PROGRESS',
    actor: staffActor(p),
    internalNotes: body.internalNotes,
    notify: false,
  });
  return getAppointmentDetail(deps, p, result.appointmentId);
}

/** Mover (día, hora, barbero), cambiar servicios o la nota interna. */
export async function updateAppointment(
  deps: CoreDeps,
  p: StaffPrincipal,
  appointmentId: string,
  rawBody: UpdateAppointmentBody,
): Promise<AppointmentDetail> {
  requirePermission(p, 'appointments:manage');
  const body = updateAppointmentBody.parse(rawBody);
  const current = await loadAppointmentForStaff(deps, p, appointmentId);
  const branch = await loadBranch(deps, p, current.branchId);

  const local = instantToLocal(current.startsAt, branch.timezone);
  const date = body.date ?? local.date;
  const minute = body.time ? timeToMinutes(body.time)! : local.minute;
  const startsAt = localToInstant(date, minute, branch.timezone);
  const barberId = body.barberId ?? current.barberId;
  const newServiceIds = body.serviceIds;
  const servicesChanged =
    !!newServiceIds &&
    (newServiceIds.length !== current.services.length ||
      newServiceIds.some((id, i) => current.services[i]?.serviceId !== id));
  const moved = startsAt.getTime() !== current.startsAt.getTime() || barberId !== current.barberId;

  if (!moved && !servicesChanged) {
    if (body.internalNotes !== undefined) {
      await deps.db.appointment.update({
        where: { id: appointmentId },
        data: { internalNotes: body.internalNotes?.trim() || null },
      });
    }
    return getAppointmentDetail(deps, p, appointmentId);
  }

  if (moved && current.status === 'IN_PROGRESS') {
    throw Errors.conflict('El turno ya está en curso: no se puede mover.');
  }
  if (moved && startsAt < new Date(deps.now().getTime() - 60 * 60_000)) {
    throw Errors.invalid('Ese horario ya pasó.');
  }

  // Servicios para validar al barbero: los nuevos (con precio actual) o los del turno.
  const services: ResolvedService[] = servicesChanged
    ? await resolveServices(deps.db, {
        organizationId: p.organizationId,
        branchId: branch.id,
        serviceIds: newServiceIds!,
        onlineOnly: false,
      })
    : current.services.map((s) => ({
        id: s.serviceId,
        name: s.service.name,
        durationMin: s.durationMin,
        priceCents: s.priceCents,
      }));
  const barber = await staffBarber(deps, branch, services, barberId);
  const rules = await loadBookingRules(deps.db, p.organizationId);
  const result = await relocateBooking(deps, {
    appointmentId,
    branch,
    barber,
    startsAt,
    ...(servicesChanged ? { services } : {}),
    mode: 'staff',
    rules,
    force: body.force,
    actor: staffActor(p),
    customerId: current.customerId,
    internalNotes: body.internalNotes === undefined ? undefined : body.internalNotes?.trim() || null,
    notify: true,
  });
  await dispatchQueued(deps, result.notificationIds);
  return getAppointmentDetail(deps, p, appointmentId);
}

/** Cambios de estado que puede hacer el staff (el cobro de la Fase 4 completará "Atendido"). */
const TRANSITIONS: Partial<Record<AppointmentStatus, AppointmentStatus[]>> = {
  BOOKED: ['CONFIRMED', 'IN_PROGRESS', 'NO_SHOW'],
  CONFIRMED: ['BOOKED', 'IN_PROGRESS', 'NO_SHOW'],
  IN_PROGRESS: ['BOOKED', 'CONFIRMED', 'COMPLETED'],
  COMPLETED: ['IN_PROGRESS'],
  NO_SHOW: ['BOOKED'],
};

export async function changeAppointmentStatus(
  deps: CoreDeps,
  p: StaffPrincipal,
  appointmentId: string,
  rawBody: AppointmentStatusBody,
  meta: RequestMeta,
): Promise<AppointmentDetail> {
  requirePermission(p, 'appointments:manage');
  const body = appointmentStatusBody.parse(rawBody);
  const current = await loadAppointmentForStaff(deps, p, appointmentId);
  const from = current.status;
  const to = body.status;
  if (!TRANSITIONS[from]?.includes(to)) {
    throw Errors.conflict('Ese cambio de estado no es posible para este turno.');
  }
  const now = deps.now();
  if (to === 'NO_SHOW' && current.startsAt > now) {
    throw Errors.conflict('Solo se puede marcar "No vino" cuando ya pasó la hora del turno.');
  }
  if (
    to === 'IN_PROGRESS' &&
    from !== 'COMPLETED' &&
    current.startsAt.getTime() - now.getTime() > 3 * 3600_000
  ) {
    throw Errors.conflict('Todavía falta mucho para este turno: no se puede empezar.');
  }

  const apply = async (tx: Parameters<Parameters<typeof withBookingLocks>[2]>[0]) => {
    const updated = await tx.appointment.updateMany({
      where: { id: appointmentId, status: from },
      data: {
        status: to,
        ...(to === 'CONFIRMED' ? { confirmedAt: now, confirmedVia: 'STAFF' as const } : {}),
        ...(to === 'IN_PROGRESS' && from !== 'COMPLETED' ? { startedAt: now } : {}),
        ...(to === 'COMPLETED' ? { completedAt: now } : {}),
        ...(from === 'COMPLETED' ? { completedAt: null } : {}),
        ...(to === 'NO_SHOW' ? { noShowAt: now } : {}),
        ...(from === 'NO_SHOW' ? { noShowAt: null } : {}),
      },
    });
    if (updated.count === 0) throw Errors.conflict('El turno cambió mientras tanto. Actualizá la agenda.');
    await tx.appointmentEvent.create({
      data: {
        appointmentId,
        type: 'STATUS_CHANGED',
        fromStatus: from,
        toStatus: to,
        actorType: 'STAFF',
        actorUserId: p.userId,
        note: body.note,
      },
    });
    if (from === 'NO_SHOW') {
      await writeAudit(tx, {
        organizationId: p.organizationId,
        branchId: current.branchId,
        actor: staffActor(p),
        action: 'APPOINTMENT_NO_SHOW_REVERTED',
        entityType: 'Appointment',
        entityId: appointmentId,
        summary: `Se quitó el "No vino" de ${customerName(current.customer) ?? 'un turno sin cliente'}`,
        reason: body.note ?? undefined,
        meta,
      });
    }
  };

  // Volver a un estado activo desde "No vino" ocupa de nuevo el horario: pasa por el lock.
  if (from === 'NO_SHOW') await withBookingLocks(deps, { barberId: current.barberId }, apply);
  else await deps.db.$transaction(apply);
  return getAppointmentDetail(deps, p, appointmentId);
}

export async function cancelAppointment(
  deps: CoreDeps,
  p: StaffPrincipal,
  appointmentId: string,
  rawBody: CancelAppointmentBody,
): Promise<AppointmentDetail> {
  requirePermission(p, 'appointments:manage');
  const body = cancelAppointmentBody.parse(rawBody);
  const current = await loadAppointmentForStaff(deps, p, appointmentId);
  const ids = await cancelInTx(deps, {
    appointmentId,
    from: current.status,
    actor: staffActor(p),
    reason: body.reason,
    note: body.note,
    notify: body.notifyCustomer && !!current.customerId && current.startsAt > deps.now(),
  });
  await dispatchQueued(deps, ids);
  return getAppointmentDetail(deps, p, appointmentId);
}

const CANCELABLE: AppointmentStatus[] = ['PENDING_PAYMENT', 'BOOKED', 'CONFIRMED'];

/** Cancela (staff o cliente): estado, historial y aviso por la bandeja de salida. */
export async function cancelInTx(
  deps: CoreDeps,
  input: {
    appointmentId: string;
    from: AppointmentStatus;
    actor: { type: 'STAFF' | 'CUSTOMER'; userId?: string; customerId?: string };
    reason: NonNullable<Prisma.AppointmentUpdateInput['cancelReason']>;
    note: string | null;
    notify: boolean;
  },
): Promise<(string | null)[]> {
  if (!CANCELABLE.includes(input.from)) throw Errors.conflict('Este turno ya no se puede cancelar.');
  const now = deps.now();
  return deps.db.$transaction(async (tx) => {
    const updated = await tx.appointment.updateMany({
      where: { id: input.appointmentId, status: input.from },
      data: {
        status: 'CANCELED',
        canceledAt: now,
        canceledBy: input.actor.type,
        cancelReason: input.reason,
        cancelNote: input.note,
      },
    });
    if (updated.count === 0) throw Errors.conflict('El turno cambió mientras tanto. Actualizá la página.');
    await tx.appointmentEvent.create({
      data: {
        appointmentId: input.appointmentId,
        type: 'STATUS_CHANGED',
        fromStatus: input.from,
        toStatus: 'CANCELED',
        actorType: input.actor.type,
        actorUserId: input.actor.userId ?? null,
        actorCustomerId: input.actor.customerId ?? null,
        note: input.note,
      },
    });
    return input.notify
      ? [
          await queueBookingNotification(tx, deps.config, {
            type: 'BOOKING_CANCELLATION',
            appointmentId: input.appointmentId,
            dedupeKey: `cancel:${input.appointmentId}`,
          }),
        ]
      : [];
  });
}
