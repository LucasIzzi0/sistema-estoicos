import { formatCents, formatPhone } from '@estoicos/shared';

export { formatCents, formatPhone };

export function formatBps(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '—';
  return `${(bps / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })} %`;
}

export function formatDate(iso: string | null | undefined, options: Intl.DateTimeFormatOptions = {}): string {
  if (!iso) return '—';
  // Una fecha suelta ("2026-09-28") es un día del calendario, no un instante: si se la parsea
  // como medianoche UTC y se la muestra en Buenos Aires, se corre un día para atrás.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00-03:00`) : new Date(iso);
  return date.toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

const TZ = 'America/Argentina/Buenos_Aires';

/** Rango para mostrar: días completos ("12 oct – 14 oct") o un horario ("12 oct, 15:00 a 17:00"). */
export function formatRange(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const hm = (d: Date) =>
    d.toLocaleTimeString('es-AR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  const day = (d: Date) => d.toLocaleDateString('es-AR', { timeZone: TZ, day: 'numeric', month: 'short' });
  if (hm(start) === '00:00' && hm(end) === '00:00') {
    const lastDay = new Date(end.getTime() - 1);
    return day(start) === day(lastDay) ? `${day(start)} (todo el día)` : `${day(start)} – ${day(lastDay)}`;
  }
  return day(start) === day(end)
    ? `${day(start)}, ${hm(start)} a ${hm(end)}`
    : `${day(start)} ${hm(start)} – ${day(end)} ${hm(end)}`;
}

/** "18:05" (hora local de Buenos Aires). */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Fecha de calendario "2026-10-13" → "13 oct 2026" (sin corrimiento de zona). */
export function formatDay(date: string, options: Intl.DateTimeFormatOptions = {}): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('es-AR', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...options,
  });
}
