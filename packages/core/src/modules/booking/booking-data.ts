import type { Db, Tx } from '@estoicos/db';
import { ACTIVE_APPOINTMENT_STATUSES, addDays, daysBetween, isoWeekday } from '@estoicos/shared';
import { Errors } from '../../errors';
import { localToInstant } from '../../time';
import { overlaps, type TimeRange, type WorkInterval } from './availability';

/** Lecturas que alimentan el motor de disponibilidad. Sirven con la base o dentro de una transacción. */
type Client = Db | Tx;

export interface BranchRef {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  timezone: string;
  address: string | null;
  city: string | null;
  bookingEnabled: boolean;
  active: boolean;
}

export const branchRefSelect = {
  id: true,
  organizationId: true,
  name: true,
  slug: true,
  timezone: true,
  address: true,
  city: true,
  bookingEnabled: true,
  active: true,
} as const;

export interface ResolvedService {
  id: string;
  name: string;
  durationMin: number;
  /** Precio en esta sucursal (override o precio base). */
  priceCents: bigint;
}

/**
 * Servicios pedidos, en el orden pedido, con el precio de la sucursal. Falla si alguno no existe,
 * está archivado, no se ofrece en la sucursal o (online) no se puede reservar por la web.
 */
export async function resolveServices(
  client: Client,
  input: { organizationId: string; branchId: string; serviceIds: string[]; onlineOnly: boolean },
): Promise<ResolvedService[]> {
  const rows = await client.service.findMany({
    where: {
      id: { in: input.serviceIds },
      organizationId: input.organizationId,
      active: true,
      archivedAt: null,
      ...(input.onlineOnly ? { onlineBookable: true } : {}),
      branchServices: { some: { branchId: input.branchId, active: true } },
    },
    include: { branchServices: { where: { branchId: input.branchId } } },
  });
  if (rows.length !== input.serviceIds.length) {
    throw Errors.invalid('Alguno de los servicios elegidos no está disponible en esta sucursal.');
  }
  return input.serviceIds.map((id) => {
    const s = rows.find((r) => r.id === id)!;
    return {
      id: s.id,
      name: s.name,
      durationMin: s.durationMin,
      priceCents: s.branchServices[0]?.priceCentsOverride ?? s.basePriceCents,
    };
  });
}

export interface EligibleBarber {
  id: string;
  displayName: string;
  sortOrder: number;
  /** Duración de cada servicio para este barbero (con su override), en el orden pedido. */
  durations: number[];
  durationMin: number;
}

/** Barberos activos en la sucursal que hacen TODOS los servicios pedidos (P13: mismo barbero). */
export async function eligibleBarbers(
  client: Client,
  input: {
    organizationId: string;
    branchId: string;
    services: ResolvedService[];
    onlineOnly: boolean;
    barberIds?: string[];
  },
): Promise<EligibleBarber[]> {
  const serviceIds = input.services.map((s) => s.id);
  const rows = await client.barber.findMany({
    where: {
      organizationId: input.organizationId,
      active: true,
      ...(input.onlineOnly ? { acceptsOnlineBooking: true } : {}),
      ...(input.barberIds ? { id: { in: input.barberIds } } : {}),
      branches: { some: { branchId: input.branchId, active: true } },
    },
    include: { services: { where: { serviceId: { in: serviceIds }, active: true } } },
    orderBy: [{ sortOrder: 'asc' }, { displayName: 'asc' }],
  });
  return rows
    .filter((b) => serviceIds.every((id) => b.services.some((s) => s.serviceId === id)))
    .map((b) => {
      const durations = input.services.map(
        (svc) => b.services.find((s) => s.serviceId === svc.id)?.durationMinOverride ?? svc.durationMin,
      );
      return {
        id: b.id,
        displayName: b.displayName,
        sortOrder: b.sortOrder,
        durations,
        durationMin: durations.reduce((a, d) => a + d, 0),
      };
    });
}

export interface BarberDayData {
  intervals: WorkInterval[];
  timeOffs: TimeRange[];
  appointments: TimeRange[];
}

export interface DayData {
  date: string;
  window: TimeRange;
  closures: TimeRange[];
  barbers: Map<string, BarberDayData>;
}

/**
 * Carga, para varios días consecutivos, todo lo que ocupa a los barberos: horario en esta
 * sucursal, bloqueos (de esta sucursal o generales), feriados y turnos activos en CUALQUIER
 * sucursal (nadie puede estar en dos lugares a la vez).
 */
export async function loadDays(
  client: Client,
  input: {
    branch: Pick<BranchRef, 'id' | 'timezone'>;
    barberIds: string[];
    from: string;
    to: string;
    excludeAppointmentId?: string | undefined;
  },
): Promise<DayData[]> {
  const { branch, barberIds } = input;
  const count = daysBetween(input.from, input.to) + 1;
  const dates = Array.from({ length: count }, (_, i) => addDays(input.from, i));
  const rangeStart = localToInstant(input.from, 0, branch.timezone);
  const rangeEnd = localToInstant(input.to, 24 * 60, branch.timezone);

  const [schedules, timeOffs, closures, appointments] = await Promise.all([
    client.barberSchedule.findMany({ where: { barberId: { in: barberIds }, branchId: branch.id } }),
    client.barberTimeOff.findMany({
      where: {
        barberId: { in: barberIds },
        OR: [{ branchId: null }, { branchId: branch.id }],
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
      },
    }),
    client.branchClosure.findMany({
      where: { branchId: branch.id, startsAt: { lt: rangeEnd }, endsAt: { gt: rangeStart } },
    }),
    client.appointment.findMany({
      where: {
        barberId: { in: barberIds },
        status: { in: [...ACTIVE_APPOINTMENT_STATUSES] },
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
        ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}),
      },
      select: { barberId: true, startsAt: true, endsAt: true },
    }),
  ]);

  const isoDate = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

  return dates.map((date) => {
    const window = {
      startsAt: localToInstant(date, 0, branch.timezone),
      endsAt: localToInstant(date, 24 * 60, branch.timezone),
    };
    const weekday = isoWeekday(date);
    const inDay = (r: TimeRange) => overlaps(r, window);
    const barbers = new Map<string, BarberDayData>();
    for (const barberId of barberIds) {
      barbers.set(barberId, {
        intervals: schedules
          .filter(
            (s) =>
              s.barberId === barberId &&
              s.weekday === weekday &&
              (!s.validFrom || isoDate(s.validFrom)! <= date) &&
              (!s.validUntil || isoDate(s.validUntil)! >= date),
          )
          .map((s) => ({ startMinute: s.startMinute, endMinute: s.endMinute })),
        timeOffs: timeOffs.filter((t) => t.barberId === barberId && inDay(t)),
        appointments: appointments.filter((a) => a.barberId === barberId && inDay(a)),
      });
    }
    return { date, window, closures: closures.filter(inDay), barbers };
  });
}
