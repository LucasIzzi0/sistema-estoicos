/**
 * Fechas de calendario "AAAA-MM-DD" sin zona horaria (el día LOCAL de la sucursal).
 * Solo usan Intl, así que sirven igual en la API, el worker y el navegador.
 */

/** "2026-10-12" + 3 → "2026-10-15". */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Día de la semana ISO: 1 = lunes … 7 = domingo. */
export function isoWeekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return day === 0 ? 7 : day;
}

/** Días entre dos fechas (b − a). */
export function daysBetween(a: string, b: string): number {
  const toUtc = (s: string) => {
    const [y, m, d] = s.split('-').map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

const partsCache = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timezone: string): Intl.DateTimeFormat {
  let f = partsCache.get(timezone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    partsCache.set(timezone, f);
  }
  return f;
}

/** Instante → fecha y minuto del día en la zona indicada. */
export function instantToLocal(instant: Date, timezone: string): { date: string; minute: number } {
  const parts = Object.fromEntries(
    formatterFor(timezone)
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Fecha de hoy en la zona de la sucursal. */
export function todayIn(timezone: string, now: Date = new Date()): string {
  return instantToLocal(now, timezone).date;
}
