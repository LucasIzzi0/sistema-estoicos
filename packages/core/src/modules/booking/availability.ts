import { minutesToTime } from '@estoicos/shared';
import { localToInstant } from '../../time';

/**
 * Motor de disponibilidad: función PURA (sin base), testeada aparte.
 *
 * horario del barbero ese día − bloqueos − cierres de la sucursal − turnos activos
 *   → inicios cada `stepMinutes` (desde el comienzo de cada tramo) donde entra la duración
 *   → filtro de anticipación mínima (`notBefore`) y máxima (`notAfter`).
 *
 * Los tramos se expresan en minutos LOCALES y se convierten a instantes con la zona de la
 * sucursal, así que un cambio de horario de verano no corre los turnos.
 */
export interface TimeRange {
  startsAt: Date;
  endsAt: Date;
}

export interface WorkInterval {
  startMinute: number;
  endMinute: number;
}

export interface BarberDay {
  barberId: string;
  /** Tramos de trabajo ese día en esa sucursal. */
  intervals: WorkInterval[];
  /** Turnos activos y bloqueos del barbero (en cualquier sucursal). */
  busy: TimeRange[];
  /** Duración total de los servicios pedidos para ESTE barbero (con sus overrides). */
  durationMin: number;
}

export interface DayInput {
  date: string;
  timezone: string;
  stepMinutes: number;
  /** Cierres de la sucursal (feriados). */
  closures: TimeRange[];
  notBefore?: Date | null;
  notAfter?: Date | null;
}

export interface BarberSlot {
  minute: number;
  startsAt: Date;
  endsAt: Date;
}

export interface MergedSlot {
  time: string;
  minute: number;
  startsAt: Date;
  barberIds: string[];
}

const MINUTE = 60_000;

export function overlaps(a: TimeRange, b: TimeRange): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Horarios libres de un barbero en un día. */
export function barberSlots(day: DayInput, barber: BarberDay): BarberSlot[] {
  if (barber.durationMin <= 0 || day.stepMinutes <= 0) return [];
  const blocked = [...barber.busy, ...day.closures];
  const slots: BarberSlot[] = [];
  const intervals = [...barber.intervals].sort((a, b) => a.startMinute - b.startMinute);

  for (const interval of intervals) {
    const intervalEnd = localToInstant(day.date, interval.endMinute, day.timezone);
    for (
      let minute = interval.startMinute;
      minute + barber.durationMin <= interval.endMinute;
      minute += day.stepMinutes
    ) {
      const startsAt = localToInstant(day.date, minute, day.timezone);
      const endsAt = new Date(startsAt.getTime() + barber.durationMin * MINUTE);
      if (endsAt > intervalEnd) break;
      if (day.notBefore && startsAt < day.notBefore) continue;
      if (day.notAfter && startsAt > day.notAfter) break;
      const range = { startsAt, endsAt };
      if (blocked.some((b) => overlaps(range, b))) continue;
      slots.push({ minute, startsAt, endsAt });
    }
  }
  return slots;
}

/** Une los horarios de varios barberos ("cualquier barbero"): cada horario con quiénes están libres. */
export function mergeSlots(day: DayInput, barbers: BarberDay[]): MergedSlot[] {
  const byMinute = new Map<number, MergedSlot>();
  for (const barber of barbers) {
    for (const slot of barberSlots(day, barber)) {
      const existing = byMinute.get(slot.minute);
      if (existing) existing.barberIds.push(barber.barberId);
      else
        byMinute.set(slot.minute, {
          time: minutesToTime(slot.minute),
          minute: slot.minute,
          startsAt: slot.startsAt,
          barberIds: [barber.barberId],
        });
    }
  }
  return [...byMinute.values()].sort((a, b) => a.minute - b.minute);
}

export type ScheduleProblem = 'OUTSIDE_SCHEDULE' | 'TIME_OFF' | 'CLOSURE';

/**
 * Para turnos cargados por el staff (que pueden salir del horario con confirmación):
 * explica por qué un rango no está dentro de la disponibilidad normal. null = está bien.
 * Los turnos que se pisan se validan aparte (eso nunca se puede forzar).
 */
export function scheduleProblem(
  day: DayInput,
  intervals: WorkInterval[],
  timeOffs: TimeRange[],
  range: TimeRange,
): ScheduleProblem | null {
  if (day.closures.some((c) => overlaps(range, c))) return 'CLOSURE';
  if (timeOffs.some((t) => overlaps(range, t))) return 'TIME_OFF';
  const inside = intervals.some(
    (i) =>
      range.startsAt >= localToInstant(day.date, i.startMinute, day.timezone) &&
      range.endsAt <= localToInstant(day.date, i.endMinute, day.timezone),
  );
  return inside ? null : 'OUTSIDE_SCHEDULE';
}

/**
 * "Cualquier barbero" (P14): el que tenga menos minutos reservados ese día; si empatan,
 * el orden que definió el admin. Devuelve los candidatos ordenados (si el primero se ocupa
 * justo en ese instante, se prueba el siguiente).
 */
export function rankBarbersForAnyChoice(
  candidates: { barberId: string; bookedMinutes: number; sortOrder: number; name: string }[],
): string[] {
  return [...candidates]
    .sort(
      (a, b) =>
        a.bookedMinutes - b.bookedMinutes || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'es'),
    )
    .map((c) => c.barberId);
}

/** Minutos ocupados por turnos dentro de un rango (para el reparto de "cualquier barbero"). */
export function bookedMinutesWithin(appointments: TimeRange[], window: TimeRange): number {
  let total = 0;
  for (const a of appointments) {
    const start = Math.max(a.startsAt.getTime(), window.startsAt.getTime());
    const end = Math.min(a.endsAt.getTime(), window.endsAt.getTime());
    if (end > start) total += (end - start) / MINUTE;
  }
  return total;
}
