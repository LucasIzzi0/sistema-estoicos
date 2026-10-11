import {
  ACTIVE_APPOINTMENT_STATUSES,
  availabilityQuery,
  customerBookingBody,
  customerRescheduleBody,
  rescheduleAvailabilityQuery,
  timeToMinutes,
  type Availability,
  type AvailabilityQuery,
  type CustomerBookingBody,
  type CustomerRescheduleBody,
  type MyAppointment,
  type MyAppointments,
  type PublicBranch,
  type PublicBranchSummary,
  type RescheduleAvailabilityQuery,
} from '@estoicos/shared';
import type { CustomerPrincipal } from '../../authz/principal';
import type { CoreDeps } from '../../deps';
import { DomainError, Errors } from '../../errors';
import { localToInstant } from '../../time';
import { dispatchQueued } from '../notifications/outbox';
import type { OrganizationRef } from '../organization/organization';
import { cancelInTx } from './agenda';
import { candidateOrder, createBooking, loadBookingRules, onlineWindow, relocateBooking } from './booking';
import { branchRefSelect, eligibleBarbers, resolveServices, type BranchRef } from './booking-data';
import { computeAvailability } from './slots';

/**
 * Reserva online: página pública por sucursal (sin login para ver horarios) y portal del cliente.
 * Reglas (P15): anticipación mínima 60 min, hasta 30 días, máximo 2 turnos futuros y reprogramar
 * hasta 3 h antes (configurable en organization_settings). Cancelar: hasta la hora del turno.
 */
async function bookableBranch(
  deps: CoreDeps,
  organizationId: string,
  where: { slug: string } | { id: string },
) {
  const branch = await deps.db.branch.findFirst({
    where: { organizationId, active: true, ...where },
    select: branchRefSelect,
  });
  if (!branch) throw Errors.notFound('No encontramos esa sucursal.');
  return branch;
}

/** Sucursales con reserva online (para elegir dónde reservar). */
export async function listPublicBranches(
  deps: CoreDeps,
  org: OrganizationRef,
): Promise<PublicBranchSummary[]> {
  return deps.db.branch.findMany({
    where: { organizationId: org.id, active: true, bookingEnabled: true },
    select: { name: true, slug: true, address: true, city: true },
    orderBy: { name: 'asc' },
  });
}

export async function getPublicBranch(
  deps: CoreDeps,
  org: OrganizationRef,
  slug: string,
): Promise<PublicBranch> {
  const branch = await bookableBranch(deps, org.id, { slug });
  const [rules, services, barbers] = await Promise.all([
    loadBookingRules(deps.db, org.id),
    deps.db.service.findMany({
      where: {
        organizationId: org.id,
        active: true,
        archivedAt: null,
        onlineBookable: true,
        branchServices: { some: { branchId: branch.id, active: true } },
      },
      include: {
        category: { select: { name: true, sortOrder: true } },
        branchServices: { where: { branchId: branch.id } },
      },
    }),
    deps.db.barber.findMany({
      where: {
        organizationId: org.id,
        active: true,
        acceptsOnlineBooking: true,
        branches: { some: { branchId: branch.id, active: true } },
      },
      include: { services: { where: { active: true }, select: { serviceId: true } } },
      orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
    }),
  ]);
  const sorted = [...services].sort(
    (a, b) =>
      (a.category?.sortOrder ?? 999) - (b.category?.sortOrder ?? 999) ||
      a.sortOrder - b.sortOrder ||
      a.name.localeCompare(b.name, 'es'),
  );
  const serviceIds = new Set(sorted.map((s) => s.id));
  return {
    id: branch.id,
    name: branch.name,
    slug: branch.slug,
    address: branch.address,
    city: branch.city,
    timezone: branch.timezone,
    bookingEnabled: branch.bookingEnabled,
    rules: {
      allowAnyBarber: rules.allowAnyBarber,
      maxDaysAhead: rules.maxDaysAhead,
      minNoticeMinutes: rules.minNoticeMinutes,
      maxActivePerCustomer: rules.maxActivePerCustomer,
      rescheduleMinNoticeHours: rules.rescheduleMinNoticeHours,
    },
    services: sorted.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      categoryName: s.category?.name ?? null,
      durationMin: s.durationMin,
      priceCents: Number(s.branchServices[0]?.priceCentsOverride ?? s.basePriceCents),
    })),
    barbers: barbers
      .map((b) => ({
        id: b.id,
        displayName: b.displayName,
        color: b.color,
        photoUrl: b.photoUrl,
        bio: b.bio,
        serviceIds: b.services.map((s) => s.serviceId).filter((id) => serviceIds.has(id)),
      }))
      .filter((b) => b.serviceIds.length > 0),
  };
}

async function onlineContext(
  deps: CoreDeps,
  branch: BranchRef,
  serviceIds: string[],
  barberId: string | null,
) {
  if (!branch.bookingEnabled) {
    throw Errors.conflict('Esta sucursal no está tomando reservas online por ahora.');
  }
  const rules = await loadBookingRules(deps.db, branch.organizationId);
  if (!barberId && !rules.allowAnyBarber) throw Errors.invalid('Elegí un barbero.');
  const services = await resolveServices(deps.db, {
    organizationId: branch.organizationId,
    branchId: branch.id,
    serviceIds,
    onlineOnly: true,
  });
  const barbers = await eligibleBarbers(deps.db, {
    organizationId: branch.organizationId,
    branchId: branch.id,
    services,
    onlineOnly: true,
    ...(barberId ? { barberIds: [barberId] } : {}),
  });
  if (barberId && !barbers.length) {
    throw Errors.invalid('Ese barbero no hace alguno de los servicios elegidos.');
  }
  return { rules, services, barbers };
}

/** Horarios disponibles sin login (con rate limit en la API). */
export async function getPublicAvailability(
  deps: CoreDeps,
  org: OrganizationRef,
  slug: string,
  rawQuery: AvailabilityQuery,
): Promise<Availability> {
  const query = availabilityQuery.parse(rawQuery);
  const branch = await bookableBranch(deps, org.id, { slug });
  const { rules, barbers } = await onlineContext(deps, branch, query.serviceIds, query.barberId ?? null);
  const window = onlineWindow(rules, branch.timezone, deps.now());
  return computeAvailability(deps, {
    branch,
    barbers,
    from: query.from,
    days: query.days,
    stepMinutes: rules.stepMinutes,
    notBefore: window.notBefore,
    notAfter: window.notAfter,
    lastDate: window.lastDate,
  });
}

/** Horarios para reprogramar un turno propio (su horario actual no cuenta como ocupado). */
export async function getRescheduleAvailability(
  deps: CoreDeps,
  p: CustomerPrincipal,
  appointmentId: string,
  rawQuery: RescheduleAvailabilityQuery,
): Promise<Availability> {
  const query = rescheduleAvailabilityQuery.parse(rawQuery);
  const mine = await loadChangeable(deps, p, appointmentId);
  const branch = await bookableBranch(deps, p.organizationId, { id: mine.branchId });
  const barberId = query.barberId === 'any' ? null : (query.barberId ?? mine.barberId);
  const { rules, barbers } = await onlineContext(
    deps,
    branch,
    mine.services.map((s) => s.serviceId),
    barberId,
  );
  const window = onlineWindow(rules, branch.timezone, deps.now());
  const duration = mine.services.reduce((a, s) => a + s.durationMin, 0);
  return computeAvailability(deps, {
    branch,
    // Se mantiene la duración reservada.
    barbers: barbers.map((b) => ({ ...b, durationMin: duration })),
    from: query.from,
    days: query.days,
    stepMinutes: rules.stepMinutes,
    notBefore: window.notBefore,
    notAfter: window.notAfter,
    lastDate: window.lastDate,
    excludeAppointmentId: appointmentId,
  });
}

async function requireBookableCustomer(deps: CoreDeps, principal: CustomerPrincipal) {
  const customer = await deps.db.customer.findFirst({
    where: { id: principal.customerId, organizationId: principal.organizationId, anonymizedAt: null },
  });
  if (!customer) throw Errors.unauthenticated();
  if (!customer.firstName || !customer.lastName || !customer.phone) {
    throw new DomainError('PROFILE_REQUIRED', 'Completá tu nombre y celular para reservar.', 409);
  }
  if (customer.bookingBlockedAt) {
    throw Errors.forbidden('No podés reservar online. Comunicate con la barbería.');
  }
  return customer;
}

export async function bookAsCustomer(
  deps: CoreDeps,
  principal: CustomerPrincipal,
  rawBody: CustomerBookingBody,
): Promise<MyAppointment> {
  const body = customerBookingBody.parse(rawBody);
  const customer = await requireBookableCustomer(deps, principal);
  const branch = await bookableBranch(deps, principal.organizationId, { id: body.branchId });
  const { rules, services, barbers } = await onlineContext(deps, branch, body.serviceIds, body.barberId);
  const startsAt = localToInstant(body.date, timeToMinutes(body.time)!, branch.timezone);
  const candidates = await candidateOrder(deps, { branch, barbers, startsAt, rules, mode: 'online' });

  const result = await createBooking(deps, {
    branch,
    services,
    candidates,
    anyBarberRequested: !body.barberId,
    customerId: customer.id,
    startsAt,
    mode: 'online',
    rules,
    source: 'ONLINE',
    status: 'BOOKED',
    actor: { type: 'CUSTOMER', customerId: customer.id },
    customerNotes: body.notes,
    maxActive: rules.maxActivePerCustomer,
    notify: true,
  });
  await dispatchQueued(deps, result.notificationIds);
  return getMyAppointment(deps, principal, result.appointmentId);
}

const myInclude = {
  branch: { select: { id: true, name: true, slug: true, address: true, city: true, timezone: true } },
  barber: { select: { id: true, displayName: true } },
  services: { include: { service: { select: { name: true } } }, orderBy: { position: 'asc' as const } },
} as const;

async function toMine(deps: CoreDeps, organizationId: string, rows: Awaited<ReturnType<typeof findMine>>) {
  const rules = await loadBookingRules(deps.db, organizationId);
  const now = deps.now();
  return rows.map((a): MyAppointment => {
    const deadline = new Date(a.startsAt.getTime() - rules.rescheduleMinNoticeHours * 3600_000);
    return {
      id: a.id,
      branchId: a.branch.id,
      branchName: a.branch.name,
      branchSlug: a.branch.slug,
      branchAddress: [a.branch.address, a.branch.city].filter(Boolean).join(', ') || null,
      barberId: a.barber.id,
      barberName: a.barber.displayName,
      status: a.status,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      timezone: a.branch.timezone,
      services: a.services.map((s) => ({
        serviceId: s.serviceId,
        name: s.service.name,
        durationMin: s.durationMin,
        priceCents: Number(s.priceCents),
      })),
      totalCents: Number(a.bookedTotalCents),
      changeDeadline: deadline.toISOString(),
      canChange: ['BOOKED', 'CONFIRMED'].includes(a.status) && now <= deadline,
      canCancel: ['BOOKED', 'CONFIRMED'].includes(a.status) && now < a.startsAt,
    };
  });
}

function findMine(deps: CoreDeps, customerId: string, extra: object = {}) {
  return deps.db.appointment.findMany({
    where: { customerId, ...extra },
    include: myInclude,
    orderBy: { startsAt: 'desc' },
    take: 50,
  });
}

async function getMyAppointment(deps: CoreDeps, p: CustomerPrincipal, appointmentId: string) {
  const rows = await findMine(deps, p.customerId, { id: appointmentId });
  if (!rows.length) throw Errors.notFound('No encontramos ese turno.');
  return (await toMine(deps, p.organizationId, rows))[0]!;
}

export async function listMyAppointments(deps: CoreDeps, p: CustomerPrincipal): Promise<MyAppointments> {
  const now = deps.now();
  const all = await toMine(deps, p.organizationId, await findMine(deps, p.customerId));
  const isUpcoming = (a: MyAppointment) =>
    (ACTIVE_APPOINTMENT_STATUSES as readonly string[]).includes(a.status) && new Date(a.endsAt) > now;
  return {
    upcoming: all.filter(isUpcoming).reverse(),
    past: all.filter((a) => !isUpcoming(a)),
  };
}

async function loadChangeable(deps: CoreDeps, p: CustomerPrincipal, appointmentId: string) {
  const mine = await getMyAppointment(deps, p, appointmentId);
  if (!mine.canChange) {
    const hours = (await loadBookingRules(deps.db, p.organizationId)).rescheduleMinNoticeHours;
    throw Errors.conflict(
      ['BOOKED', 'CONFIRMED'].includes(mine.status)
        ? `Los cambios se hacen hasta ${hours} horas antes del turno. Comunicate con la barbería.`
        : 'Este turno ya no se puede modificar.',
    );
  }
  return mine;
}

export async function cancelMyAppointment(
  deps: CoreDeps,
  p: CustomerPrincipal,
  appointmentId: string,
): Promise<MyAppointment> {
  // Cancelar se puede hasta la hora del turno: mejor que avise tarde a que no avise.
  const mine = await getMyAppointment(deps, p, appointmentId);
  if (!mine.canCancel) {
    throw Errors.conflict(
      ['BOOKED', 'CONFIRMED'].includes(mine.status)
        ? 'El turno ya empezó: comunicate con la barbería.'
        : 'Este turno ya no se puede cancelar.',
    );
  }
  const ids = await cancelInTx(deps, {
    appointmentId,
    from: mine.status,
    actor: { type: 'CUSTOMER', customerId: p.customerId },
    reason: 'CUSTOMER_REQUEST',
    note: null,
    notify: true,
  });
  await dispatchQueued(deps, ids);
  return getMyAppointment(deps, p, appointmentId);
}

export async function rescheduleMyAppointment(
  deps: CoreDeps,
  p: CustomerPrincipal,
  appointmentId: string,
  rawBody: CustomerRescheduleBody,
): Promise<MyAppointment> {
  const body = customerRescheduleBody.parse(rawBody);
  const rules = await loadBookingRules(deps.db, p.organizationId);
  if (!rules.customerCanReschedule) {
    throw Errors.forbidden('Para cambiar el horario, comunicate con la barbería.');
  }
  await requireBookableCustomer(deps, p);
  const mine = await loadChangeable(deps, p, appointmentId);
  const branch = await bookableBranch(deps, p.organizationId, { id: mine.branchId });
  const barberId = body.barberId === undefined ? mine.barberId : body.barberId;
  const { barbers } = await onlineContext(
    deps,
    branch,
    mine.services.map((s) => s.serviceId),
    barberId,
  );
  const startsAt = localToInstant(body.date, timeToMinutes(body.time)!, branch.timezone);
  const candidates = await candidateOrder(deps, {
    branch,
    barbers,
    startsAt,
    rules,
    mode: 'online',
    excludeAppointmentId: appointmentId,
  });

  let lastError: unknown = Errors.slotTaken();
  for (const barber of candidates.slice(0, 5)) {
    try {
      const result = await relocateBooking(deps, {
        appointmentId,
        branch,
        // Los servicios no cambian: se mantiene la duración reservada.
        barber: { ...barber, durationMin: mine.services.reduce((a, s) => a + s.durationMin, 0) },
        startsAt,
        mode: 'online',
        rules,
        actor: { type: 'CUSTOMER', customerId: p.customerId },
        customerId: p.customerId,
        maxActive: rules.maxActivePerCustomer,
        notify: true,
      });
      await dispatchQueued(deps, result.notificationIds);
      return getMyAppointment(deps, p, appointmentId);
    } catch (error) {
      lastError = error;
      if (!(error instanceof DomainError && error.code === 'SLOT_TAKEN' && barberId === null)) throw error;
    }
  }
  throw lastError;
}
