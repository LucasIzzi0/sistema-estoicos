import type { Prisma } from '@estoicos/db';
import {
  createBarberBody,
  createTimeOffBody,
  DEFAULT_TIMEZONE,
  findOverlap,
  minutesToTime,
  setBarberScheduleBody,
  setBarberServicesBody,
  timeToMinutes,
  updateBarberBody,
  validateWeeklySchedule,
  weekdayLabel,
  type BarberDetail,
  type BarberSummary,
  type CreateBarberBody,
  type CreateTimeOffBody,
  type SetBarberScheduleBody,
  type SetBarberServicesBody,
  type UpdateBarberBody,
} from '@estoicos/shared';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import { canManageAcross, requireBranchesAccess } from '../../authz/scope';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors } from '../../errors';
import { localDayRange, localToInstant } from '../../time';
import { writeAudit } from '../audit/audit';

/**
 * Barberos: perfiles SIN acceso al sistema (decisión del 25/09/2026). Un encargado gestiona
 * los barberos cuyas sucursales están todas dentro de las suyas; el dueño, todos.
 */
const summaryInclude = {
  branches: { where: { active: true }, select: { branchId: true } },
  _count: { select: { services: { where: { active: true } }, schedules: true } },
} as const;
type SummaryRow = Prisma.BarberGetPayload<{ include: typeof summaryInclude }>;

function toSummary(b: SummaryRow): BarberSummary {
  return {
    id: b.id,
    displayName: b.displayName,
    color: b.color,
    active: b.active,
    acceptsOnlineBooking: b.acceptsOnlineBooking,
    branchIds: b.branches.map((x) => x.branchId),
    serviceCount: b._count.services,
    hasSchedule: b._count.schedules > 0,
  };
}

function visibleTo(p: StaffPrincipal): Prisma.BarberWhereInput {
  return {
    organizationId: p.organizationId,
    ...(p.accessLevel === 'OWNER'
      ? {}
      : { branches: { some: { branchId: { in: p.branchIds }, active: true } } }),
  };
}

export async function listBarbers(
  deps: CoreDeps,
  p: StaffPrincipal,
  options: { includeInactive?: boolean } = {},
): Promise<BarberSummary[]> {
  requirePermission(p, 'barbers:read');
  const rows = await deps.db.barber.findMany({
    where: { ...visibleTo(p), ...(options.includeInactive ? {} : { active: true }) },
    include: summaryInclude,
    orderBy: [{ active: 'desc' }, { sortOrder: 'asc' }, { displayName: 'asc' }],
  });
  return rows.map(toSummary);
}

async function loadForManage(deps: CoreDeps, p: StaffPrincipal, barberId: string) {
  requirePermission(p, 'barbers:manage');
  const barber = await deps.db.barber.findFirst({
    where: { id: barberId, ...visibleTo(p) },
    include: summaryInclude,
  });
  if (!barber) throw Errors.notFound('No encontramos ese barbero.');
  if (
    !canManageAcross(
      p,
      barber.branches.map((b) => b.branchId),
    )
  ) {
    throw Errors.forbidden('Este barbero trabaja también en sucursales que no gestionás. Pedíselo al dueño.');
  }
  return barber;
}

export async function getBarber(deps: CoreDeps, p: StaffPrincipal, barberId: string): Promise<BarberDetail> {
  requirePermission(p, 'barbers:read');
  const barber = await deps.db.barber.findFirst({
    where: { id: barberId, ...visibleTo(p) },
    include: {
      ...summaryInclude,
      services: {
        where: { active: true },
        include: { service: true },
        orderBy: { service: { sortOrder: 'asc' } },
      },
      schedules: { orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] },
      timeOffs: { where: { endsAt: { gte: deps.now() } }, orderBy: { startsAt: 'asc' }, take: 50 },
    },
  });
  if (!barber) throw Errors.notFound('No encontramos ese barbero.');
  return {
    ...toSummary(barber),
    bio: barber.bio,
    serviceCommissionBps: barber.serviceCommissionBps,
    productCommissionBps: barber.productCommissionBps,
    tipCommissionBps: barber.tipCommissionBps,
    settlementPeriod: barber.settlementPeriod,
    services: barber.services.map((s) => ({
      serviceId: s.serviceId,
      serviceName: s.service.name,
      durationMin: s.service.durationMin,
      durationMinOverride: s.durationMinOverride,
      commissionBpsOverride: s.commissionBpsOverride,
    })),
    schedules: barber.schedules.map((s) => ({
      branchId: s.branchId,
      weekday: s.weekday,
      startMinute: s.startMinute,
      endMinute: s.endMinute,
    })),
    timeOffs: barber.timeOffs.map((t) => ({
      id: t.id,
      branchId: t.branchId,
      type: t.type,
      startsAt: t.startsAt.toISOString(),
      endsAt: t.endsAt.toISOString(),
      note: t.note,
    })),
  };
}

/** Crea el perfil. Por defecto hace todos los servicios activos (se ajusta después). */
export async function createBarber(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: CreateBarberBody,
  meta: RequestMeta,
): Promise<BarberDetail> {
  requirePermission(p, 'barbers:manage');
  const body = createBarberBody.parse(rawBody);
  requireBranchesAccess(p, body.branchIds);
  const id = await deps.db.$transaction(async (tx) => {
    const services = await tx.service.findMany({
      where: { organizationId: p.organizationId, active: true, archivedAt: null },
      select: { id: true },
    });
    const barber = await tx.barber.create({
      data: {
        organizationId: p.organizationId,
        displayName: body.displayName,
        color: body.color,
        bio: body.bio,
        acceptsOnlineBooking: body.acceptsOnlineBooking,
        serviceCommissionBps: body.serviceCommissionBps,
        productCommissionBps: body.productCommissionBps,
        tipCommissionBps: body.tipCommissionBps,
        settlementPeriod: body.settlementPeriod,
        branches: { create: body.branchIds.map((branchId) => ({ branchId })) },
        services: { create: services.map((s) => ({ serviceId: s.id })) },
      },
    });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'COMMISSION_RATE_CHANGED',
      entityType: 'Barber',
      entityId: barber.id,
      summary: `Alta de ${body.displayName} con sus comisiones`,
      after: {
        serviceCommissionBps: body.serviceCommissionBps,
        productCommissionBps: body.productCommissionBps,
        tipCommissionBps: body.tipCommissionBps,
      },
      meta,
    });
    return barber.id;
  });
  return getBarber(deps, p, id);
}

export async function updateBarber(
  deps: CoreDeps,
  p: StaffPrincipal,
  barberId: string,
  rawBody: UpdateBarberBody,
  meta: RequestMeta,
): Promise<BarberDetail> {
  const current = await loadForManage(deps, p, barberId);
  const body = updateBarberBody.parse(rawBody);
  if (body.branchIds) requireBranchesAccess(p, body.branchIds);

  await deps.db.$transaction(async (tx) => {
    const { branchIds, ...fields } = body;
    await tx.barber.update({ where: { id: barberId }, data: fields });

    if (branchIds) {
      const removed = current.branches.map((b) => b.branchId).filter((id) => !branchIds.includes(id));
      await tx.barberBranch.deleteMany({ where: { barberId } });
      await tx.barberBranch.createMany({ data: branchIds.map((branchId) => ({ barberId, branchId })) });
      // Deja de trabajar en esa sucursal: se borra su horario ahí.
      if (removed.length)
        await tx.barberSchedule.deleteMany({ where: { barberId, branchId: { in: removed } } });
    }

    const commissionKeys = ['serviceCommissionBps', 'productCommissionBps', 'tipCommissionBps'] as const;
    const changed = commissionKeys.filter((k) => body[k] !== undefined && body[k] !== current[k]);
    if (changed.length) {
      await writeAudit(tx, {
        organizationId: p.organizationId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'COMMISSION_RATE_CHANGED',
        entityType: 'Barber',
        entityId: barberId,
        summary: `Comisiones de ${current.displayName}`,
        before: Object.fromEntries(changed.map((k) => [k, current[k]])),
        after: Object.fromEntries(changed.map((k) => [k, body[k]!])),
        meta,
      });
    }
  });
  return getBarber(deps, p, barberId);
}

/** Reemplaza la lista de servicios que hace el barbero (con duración y comisión propias opcionales). */
export async function setBarberServices(
  deps: CoreDeps,
  p: StaffPrincipal,
  barberId: string,
  rawBody: SetBarberServicesBody,
  meta: RequestMeta,
): Promise<BarberDetail> {
  const current = await loadForManage(deps, p, barberId);
  const body = setBarberServicesBody.parse(rawBody);
  const ids = body.services.map((s) => s.serviceId);
  if (new Set(ids).size !== ids.length) throw Errors.invalid('Hay servicios repetidos.');
  const count = await deps.db.service.count({ where: { organizationId: p.organizationId, id: { in: ids } } });
  if (count !== ids.length) throw Errors.invalid('Alguno de los servicios no existe.');

  await deps.db.$transaction(async (tx) => {
    const before = await tx.barberService.findMany({ where: { barberId } });
    await tx.barberService.deleteMany({ where: { barberId } });
    await tx.barberService.createMany({ data: body.services.map((s) => ({ barberId, ...s })) });

    const overrideChanged = body.services.some(
      (s) =>
        (before.find((b) => b.serviceId === s.serviceId)?.commissionBpsOverride ?? null) !==
        s.commissionBpsOverride,
    );
    if (overrideChanged) {
      await writeAudit(tx, {
        organizationId: p.organizationId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'COMMISSION_RATE_CHANGED',
        entityType: 'Barber',
        entityId: barberId,
        summary: `Comisiones por servicio de ${current.displayName}`,
        before: before.map((b) => ({
          serviceId: b.serviceId,
          commissionBpsOverride: b.commissionBpsOverride,
        })),
        after: body.services.map((s) => ({
          serviceId: s.serviceId,
          commissionBpsOverride: s.commissionBpsOverride,
        })),
        meta,
      });
    }
  });
  return getBarber(deps, p, barberId);
}

/**
 * Reemplaza el horario semanal del barbero en una sucursal. Valida que los tramos no se pisen,
 * ni entre sí ni con su horario en OTRAS sucursales (no puede estar en dos lugares a la vez).
 */
export async function setBarberSchedule(
  deps: CoreDeps,
  p: StaffPrincipal,
  barberId: string,
  rawBody: SetBarberScheduleBody,
): Promise<BarberDetail> {
  const current = await loadForManage(deps, p, barberId);
  const body = setBarberScheduleBody.parse(rawBody);
  requireBranchAccess(p, body.branchId);
  if (!current.branches.some((b) => b.branchId === body.branchId)) {
    throw Errors.invalid('El barbero no trabaja en esa sucursal. Agregala primero en su perfil.');
  }
  const problem = validateWeeklySchedule(body.intervals);
  if (problem) throw Errors.invalid(problem);

  const elsewhere = await deps.db.barberSchedule.findMany({
    where: { barberId, branchId: { not: body.branchId } },
    include: { branch: { select: { name: true } } },
  });
  const clash = findOverlap(body.intervals, elsewhere);
  if (clash) {
    const other = elsewhere.find((e) => e === clash.b)?.branch.name ?? 'otra sucursal';
    throw Errors.invalid(
      `${weekdayLabel(clash.weekday)} ${minutesToTime(clash.a.startMinute)}–${minutesToTime(clash.a.endMinute)} se pisa con su horario en ${other}.`,
    );
  }

  await deps.db.$transaction(async (tx) => {
    await tx.barberSchedule.deleteMany({ where: { barberId, branchId: body.branchId } });
    await tx.barberSchedule.createMany({
      data: body.intervals.map((i) => ({ barberId, branchId: body.branchId, ...i })),
    });
  });
  return getBarber(deps, p, barberId);
}

/** Bloqueo (vacaciones, trámite, enfermedad): días completos o un rango horario en un día. */
export async function createTimeOff(
  deps: CoreDeps,
  p: StaffPrincipal,
  barberId: string,
  rawBody: CreateTimeOffBody,
): Promise<BarberDetail> {
  const current = await loadForManage(deps, p, barberId);
  const body = createTimeOffBody.parse(rawBody);
  if (body.branchId) {
    requireBranchAccess(p, body.branchId);
    if (!current.branches.some((b) => b.branchId === body.branchId)) {
      throw Errors.invalid('El barbero no trabaja en esa sucursal.');
    }
  }
  const branch = await deps.db.branch.findFirst({
    where: { id: body.branchId ?? current.branches[0]?.branchId ?? '', organizationId: p.organizationId },
    select: { timezone: true },
  });
  const tz = branch?.timezone ?? DEFAULT_TIMEZONE;

  let range: { startsAt: Date; endsAt: Date } | null;
  if (body.startTime && body.endTime) {
    const start = timeToMinutes(body.startTime)!;
    const end = timeToMinutes(body.endTime)!;
    range =
      end > start
        ? { startsAt: localToInstant(body.date, start, tz), endsAt: localToInstant(body.date, end, tz) }
        : null;
  } else {
    range = localDayRange(body.date, body.endDate, tz);
  }
  if (!range) throw Errors.invalid('El fin tiene que ser posterior al inicio.');

  await deps.db.barberTimeOff.create({
    data: {
      barberId,
      branchId: body.branchId,
      type: body.type,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      note: body.note,
      createdById: p.userId,
    },
  });
  return getBarber(deps, p, barberId);
}

export async function deleteTimeOff(deps: CoreDeps, p: StaffPrincipal, barberId: string, timeOffId: string) {
  await loadForManage(deps, p, barberId);
  const result = await deps.db.barberTimeOff.deleteMany({ where: { id: timeOffId, barberId } });
  if (result.count === 0) throw Errors.notFound('No encontramos ese bloqueo.');
  return getBarber(deps, p, barberId);
}
