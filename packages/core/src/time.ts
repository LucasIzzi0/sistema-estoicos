import { TZDate } from '@date-fns/tz';

/**
 * Fecha y hora LOCAL de una sucursal → instante (Date en UTC).
 * "2026-10-12" a los 600 minutos (10:00) en Buenos Aires → 2026-10-12T13:00:00Z.
 * Se usa la zona IANA de la sucursal: si Argentina volviera al horario de verano, sigue bien.
 */
export function localToInstant(date: string, minutesOfDay: number, timezone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  return new Date(new TZDate(y, m - 1, d, hours, minutes, 0, timezone).getTime());
}

/** Días completos locales [desde 00:00, hasta el día siguiente a endDate 00:00). */
export function localDayRange(date: string, endDate: string | null | undefined, timezone: string) {
  const last = endDate ?? date;
  if (last < date) return null;
  const startsAt = localToInstant(date, 0, timezone);
  const endsAt = localToInstant(last, 24 * 60, timezone);
  return { startsAt, endsAt };
}
