import { addDays, instantToLocal, isoWeekday, minutesToTime, type AppointmentStatus } from '@estoicos/shared';

/** Minutos locales de un instante dentro de un día dado (recortado a 0–1440 si empieza o termina otro día). */
export function minuteWithin(iso: string, date: string, timezone: string): number {
  const local = instantToLocal(new Date(iso), timezone);
  if (local.date < date) return 0;
  if (local.date > date) return 24 * 60;
  return local.minute;
}

export function localDateOf(iso: string, timezone: string): string {
  return instantToLocal(new Date(iso), timezone).date;
}

export function localTimeOf(iso: string, timezone: string): string {
  return minutesToTime(instantToLocal(new Date(iso), timezone).minute);
}

/** Lunes de la semana de esa fecha. */
export function weekStart(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** Horarios cada 15 minutos para elegir a mano (07:00 a 23:45). */
export const QUARTER_HOURS = Array.from({ length: (24 - 7) * 4 }, (_, i) => minutesToTime(7 * 60 + i * 15));

/** Estilo de cada estado en la agenda. */
/**
 * Cómo se ve cada turno en la grilla. La barra de color a la izquierda se lee de un vistazo,
 * que es lo que uno hace con una agenda: mirarla de lejos y entenderla.
 */
export const STATUS_STYLE: Record<AppointmentStatus, string> = {
  PENDING_PAYMENT: 'bg-warning/10 border-dashed border-l-4 border-l-warning',
  BOOKED: 'bg-card border-l-4 border-l-muted-foreground/40',
  CONFIRMED: 'bg-card border-l-4 border-l-primary',
  IN_PROGRESS: 'bg-success/10 border-l-4 border-l-success',
  COMPLETED: 'bg-muted text-muted-foreground border-l-4 border-l-transparent',
  CANCELED: 'bg-muted text-muted-foreground line-through border-l-4 border-l-transparent',
  NO_SHOW: 'bg-destructive/10 text-destructive line-through border-l-4 border-l-destructive',
};

/**
 * Carriles para turnos que se superponen en una misma columna (un "no vino" y un turno nuevo
 * en el mismo horario, por ejemplo). Devuelve el carril y cuántos carriles tiene su grupo.
 */
export function layoutLanes<T extends { start: number; end: number }>(items: T[]) {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map<T, { lane: number; lanes: number }>();
  let cluster: T[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    const lanes = laneEnds.length || 1;
    for (const item of cluster) result.set(item, { ...result.get(item)!, lanes });
    cluster = [];
    laneEnds = [];
  };
  for (const item of sorted) {
    if (item.start >= clusterEnd && cluster.length) flush();
    let lane = laneEnds.findIndex((end) => end <= item.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.end);
    } else laneEnds[lane] = item.end;
    result.set(item, { lane, lanes: 1 });
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  flush();
  return result;
}
