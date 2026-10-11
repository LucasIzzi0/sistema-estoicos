/** Horarios semanales en "minutos desde las 00:00" hora local de la sucursal (600 = 10:00). */
export interface ScheduleInterval {
  /** 1 = lunes … 7 = domingo (ISO 8601). */
  weekday: number;
  startMinute: number;
  endMinute: number;
}

export const WEEKDAYS = [
  { value: 1, label: 'Lunes', short: 'Lun' },
  { value: 2, label: 'Martes', short: 'Mar' },
  { value: 3, label: 'Miércoles', short: 'Mié' },
  { value: 4, label: 'Jueves', short: 'Jue' },
  { value: 5, label: 'Viernes', short: 'Vie' },
  { value: 6, label: 'Sábado', short: 'Sáb' },
  { value: 7, label: 'Domingo', short: 'Dom' },
] as const;

export function weekdayLabel(weekday: number): string {
  return WEEKDAYS.find((d) => d.value === weekday)?.label ?? `Día ${weekday}`;
}

/** 630 → "10:30"; 1440 → "24:00". */
export function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "10:30" → 630. Devuelve null si no es una hora válida. */
export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (m > 59 || h > 24 || (h === 24 && m > 0)) return null;
  return h * 60 + m;
}

/**
 * Valida un horario semanal: horas coherentes (múltiplos de 5 minutos) y tramos del mismo día
 * que no se pisen. Devuelve el problema en español, o null si está bien.
 */
export function validateWeeklySchedule(intervals: ScheduleInterval[]): string | null {
  for (const i of intervals) {
    if (!Number.isInteger(i.weekday) || i.weekday < 1 || i.weekday > 7) return 'Hay un día inválido.';
    if (i.startMinute < 0 || i.endMinute > 1440 || i.startMinute >= i.endMinute) {
      return `${weekdayLabel(i.weekday)}: la hora de fin tiene que ser posterior a la de inicio.`;
    }
    if (i.startMinute % 5 !== 0 || i.endMinute % 5 !== 0) {
      return `${weekdayLabel(i.weekday)}: usá horarios de 5 en 5 minutos.`;
    }
  }
  const overlap = findOverlap(intervals, intervals, true);
  return overlap
    ? `${weekdayLabel(overlap.weekday)}: los tramos ${minutesToTime(overlap.a.startMinute)}–${minutesToTime(
        overlap.a.endMinute,
      )} y ${minutesToTime(overlap.b.startMinute)}–${minutesToTime(overlap.b.endMinute)} se pisan.`
    : null;
}

/** Primer par de tramos del mismo día que se pisan entre dos listas (o dentro de una). */
export function findOverlap(
  a: ScheduleInterval[],
  b: ScheduleInterval[],
  sameList = false,
): { weekday: number; a: ScheduleInterval; b: ScheduleInterval } | null {
  for (let i = 0; i < a.length; i++) {
    for (let j = sameList ? i + 1 : 0; j < b.length; j++) {
      const x = a[i]!;
      const y = b[j]!;
      if (x.weekday === y.weekday && x.startMinute < y.endMinute && y.startMinute < x.endMinute) {
        return { weekday: x.weekday, a: x, b: y };
      }
    }
  }
  return null;
}
