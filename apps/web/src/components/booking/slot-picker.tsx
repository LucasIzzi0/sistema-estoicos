'use client';

import { addDays, todayIn, type Availability, type Slot } from '@estoicos/shared';
import { ChevronRight, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiClientError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

const WINDOW_DAYS = 14;

/** "2026-10-13" → { weekday: "mar", day: "13", month: "oct" } (fecha de calendario, sin zona). */
export function dayParts(date: string) {
  const d = new Date(`${date}T12:00:00Z`);
  const fmt = (o: Intl.DateTimeFormatOptions) => d.toLocaleDateString('es-AR', { timeZone: 'UTC', ...o });
  return {
    weekday: fmt({ weekday: 'short' }).replace('.', ''),
    day: fmt({ day: 'numeric' }),
    month: fmt({ month: 'short' }).replace('.', ''),
    long: fmt({ weekday: 'long', day: 'numeric', month: 'long' }).replace(',', ''),
  };
}

const GROUPS = [
  { label: 'Mañana', test: (t: string) => t < '13:00' },
  { label: 'Tarde', test: (t: string) => t >= '13:00' && t < '18:00' },
  { label: 'Noche', test: (t: string) => t >= '18:00' },
];

/**
 * Tira de días + horarios libres. Carga de a 14 días (lo que permite la API) y deja pedir más
 * hasta el último día reservable. `load` decide de dónde salen los horarios (público, panel,
 * reprogramación).
 */
export function SlotPicker(props: {
  timezone: string;
  load: (from: string, days: number) => Promise<Availability>;
  /** Cambia cuando cambian los filtros (servicios, barbero): se recarga desde cero. */
  reloadKey: string;
  selected: { date: string; time: string } | null;
  onSelect: (value: { date: string; time: string; slot: Slot }) => void;
  initialDate?: string;
}) {
  const { load, reloadKey, onSelect } = props;
  const start = props.initialDate ?? todayIn(props.timezone);
  const [days, setDays] = useState<Availability['days']>([]);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [activeDate, setActiveDate] = useState<string | null>(props.selected?.date ?? null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const fetchWindow = useCallback(
    async (from: string, replace: boolean) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const data = await load(from, WINDOW_DAYS);
        if (id !== requestId.current) return;
        setLastDate(data.lastDate);
        setDays((prev) => (replace ? data.days : [...prev, ...data.days]));
        if (replace) {
          setActiveDate((current) =>
            current && data.days.some((d) => d.date === current)
              ? current
              : (data.days.find((d) => d.slots.length)?.date ?? data.days[0]?.date ?? null),
          );
        }
      } catch (e) {
        if (id === requestId.current)
          setError(e instanceof ApiClientError ? e.message : 'No pudimos cargar los horarios.');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [load],
  );

  useEffect(() => {
    void fetchWindow(start, true);
    // Se recarga solo cuando cambian los filtros (reloadKey) o el día inicial.
  }, [reloadKey, start]);

  const nextFrom = days.length ? addDays(days.at(-1)!.date, 1) : null;
  const canLoadMore = !!nextFrom && (!lastDate || nextFrom <= lastDate);
  const active = days.find((d) => d.date === activeDate);

  return (
    <div className="grid gap-4">
      <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-2" role="listbox" aria-label="Día">
        {days.map((d) => {
          const p = dayParts(d.date);
          const free = d.slots.length;
          const isActive = d.date === activeDate;
          return (
            <button
              key={d.date}
              type="button"
              role="option"
              aria-selected={isActive}
              disabled={!free}
              onClick={() => setActiveDate(d.date)}
              className={cn(
                'grid min-w-16 snap-start justify-items-center gap-0.5 rounded-lg border px-2 py-2 text-sm transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'hover:border-foreground/40 disabled:opacity-40',
              )}
            >
              <span className="text-xs uppercase">{p.weekday}</span>
              <span className="text-lg font-bold leading-none">{p.day}</span>
              <span className="text-xs">{free ? p.month : 'sin turnos'}</span>
            </button>
          );
        })}
        {canLoadMore && (
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-w-16 flex-col"
            disabled={loading}
            onClick={() => void fetchWindow(nextFrom!, false)}
          >
            <ChevronRight />
            <span className="text-xs">Más días</span>
          </Button>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {loading && !days.length ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Buscando horarios…
        </p>
      ) : !days.some((d) => d.slots.length) && !loading ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No hay horarios libres en estos días.{canLoadMore ? ' Probá con “Más días”.' : ''}
        </p>
      ) : active ? (
        <div className="grid gap-4" aria-live="polite">
          <p className="text-sm font-medium first-letter:uppercase">{dayParts(active.date).long}</p>
          {GROUPS.map((g) => {
            const slots = active.slots.filter((s) => g.test(s.time));
            if (!slots.length) return null;
            return (
              <div key={g.label} className="grid gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{g.label}</p>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
                  {slots.map((slot) => {
                    const isSelected =
                      props.selected?.date === active.date && props.selected.time === slot.time;
                    return (
                      <button
                        key={slot.time}
                        type="button"
                        onClick={() => onSelect({ date: active.date, time: slot.time, slot })}
                        aria-pressed={isSelected}
                        className={cn(
                          'rounded-md border py-2 text-sm font-medium tabular-nums transition-colors',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'hover:border-foreground/40',
                        )}
                      >
                        {slot.time}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
