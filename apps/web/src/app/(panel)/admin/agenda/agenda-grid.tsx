'use client';

import {
  APPOINTMENT_STATUS_LABELS,
  instantToLocal,
  minutesToTime,
  TIME_OFF_LABELS,
  type Agenda,
  type AgendaAppointment,
} from '@estoicos/shared';
import { AlertTriangle, CheckCircle2, Globe } from 'lucide-react';
import { useEffect, useState } from 'react';
import { layoutLanes, minuteWithin, STATUS_STYLE } from '@/lib/agenda';
import { cn } from '@/lib/utils';

/** 1,6 px por minuto: un bloque de 15 minutos mide 24 px (cómodo para tocar en el celular). */
const PX = 1.6;

export interface AgendaColumn {
  key: string;
  title: string;
  subtitle?: string;
  color: string | null;
  barberId: string;
  date: string;
}

export function AgendaGrid(props: {
  agenda: Agenda;
  columns: AgendaColumn[];
  timezone: string;
  today: string;
  onOpen: (appointmentId: string) => void;
  onEmptyClick?: (column: AgendaColumn, time: string) => void;
}) {
  const { agenda, columns, timezone } = props;

  // Rango visible: del primer horario de trabajo (o turno) al último, en horas enteras.
  const starts: number[] = [];
  const ends: number[] = [];
  for (const b of agenda.barbers) {
    for (const h of b.workingHours) {
      starts.push(h.startMinute);
      ends.push(h.endMinute);
    }
  }
  const perColumn = columns.map((col) => {
    const appointments = agenda.appointments
      .filter((a) => a.barberId === col.barberId)
      .map((a) => ({
        a,
        start: minuteWithin(a.startsAt, col.date, timezone),
        end: minuteWithin(a.endsAt, col.date, timezone),
      }))
      .filter((x) => x.end > x.start && instantToLocal(new Date(x.a.startsAt), timezone).date <= col.date);
    for (const x of appointments) {
      starts.push(x.start);
      ends.push(x.end);
    }
    return { col, appointments };
  });
  const rangeStart = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 9 * 60;
  const rangeEnd = ends.length ? Math.ceil(Math.max(...ends) / 60) * 60 : 21 * 60;
  const height = (rangeEnd - rangeStart) * PX;
  const hours = Array.from({ length: (rangeEnd - rangeStart) / 60 + 1 }, (_, i) => rangeStart + i * 60);

  const now = useNow();
  const nowLocal = instantToLocal(now, timezone);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <div className="min-w-fit">
        {/* Encabezado de columnas */}
        <div className="sticky top-0 z-20 flex border-b bg-background">
          <div className="w-14 shrink-0" />
          {columns.map((col) => (
            <div key={col.key} className="flex min-w-40 flex-1 items-center gap-2 border-l px-3 py-2">
              <span className="size-2.5 shrink-0 rounded-full" style={{ background: col.color ?? '#888' }} />
              <span className="truncate text-sm font-semibold capitalize">{col.title}</span>
              {col.subtitle && <span className="text-xs text-primary">{col.subtitle}</span>}
              <span className="ml-auto text-xs text-muted-foreground">
                {perColumn
                  .find((p) => p.col.key === col.key)!
                  .appointments.filter((x) => x.a.status !== 'NO_SHOW').length || ''}
              </span>
            </div>
          ))}
        </div>

        <div className="flex">
          {/* Horas */}
          <div className="relative w-14 shrink-0" style={{ height }}>
            {hours.map((m) => (
              <span
                key={m}
                className={cn(
                  'absolute right-2 text-[11px] tabular-nums text-muted-foreground',
                  m === rangeStart ? 'translate-y-0.5' : '-translate-y-1/2',
                )}
                style={{ top: (m - rangeStart) * PX }}
              >
                {m < rangeEnd ? minutesToTime(m) : ''}
              </span>
            ))}
          </div>

          {perColumn.map(({ col, appointments }) => {
            const working = agenda.barbers
              .find((b) => b.id === col.barberId)
              ?.workingHours.filter((h) => h.date === col.date);
            const offs = agenda.timeOffs
              .filter((t) => t.barberId === col.barberId)
              .map((t) => ({
                t,
                start: minuteWithin(t.startsAt, col.date, timezone),
                end: minuteWithin(t.endsAt, col.date, timezone),
              }))
              .filter((x) => x.end > x.start);
            const closures = agenda.closures
              .map((c) => ({
                c,
                start: minuteWithin(c.startsAt, col.date, timezone),
                end: minuteWithin(c.endsAt, col.date, timezone),
              }))
              .filter((x) => x.end > x.start);
            const lanes = layoutLanes(appointments);
            const isToday = col.date === props.today && nowLocal.date === col.date;

            return (
              <div
                key={col.key}
                className={cn(
                  'relative min-w-40 flex-1 border-l bg-muted/60',
                  props.onEmptyClick && 'cursor-cell',
                )}
                style={{ height }}
                onClick={(e) => {
                  if (!props.onEmptyClick || e.target !== e.currentTarget) return;
                  const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
                  const minute = Math.floor((rangeStart + y / PX) / 15) * 15;
                  props.onEmptyClick(col, minutesToTime(minute));
                }}
              >
                {/* Horario de trabajo (claro) sobre el fondo gris de "no trabaja" */}
                {working?.map((h) => (
                  <div
                    key={h.startMinute}
                    className="pointer-events-none absolute inset-x-0 bg-background"
                    style={{
                      top: (h.startMinute - rangeStart) * PX,
                      height: (h.endMinute - h.startMinute) * PX,
                    }}
                  />
                ))}
                {/* Líneas de cuartos de hora */}
                {Array.from({ length: (rangeEnd - rangeStart) / 15 }, (_, i) => (
                  <div
                    key={i}
                    className={cn(
                      'pointer-events-none absolute inset-x-0 border-t',
                      i % 4 === 0 ? 'border-border' : 'border-border/40 border-dashed',
                    )}
                    style={{ top: i * 15 * PX }}
                  />
                ))}
                {[
                  ...closures.map((x) => ({ key: x.c.id, start: x.start, end: x.end, label: x.c.reason })),
                  ...offs.map((x) => ({
                    key: x.t.id,
                    start: x.start,
                    end: x.end,
                    label: x.t.note || TIME_OFF_LABELS[x.t.type as keyof typeof TIME_OFF_LABELS] || 'Bloqueo',
                  })),
                ].map((b) => (
                  <div
                    key={b.key}
                    className="pointer-events-none absolute inset-x-0 overflow-hidden bg-[repeating-linear-gradient(135deg,transparent,transparent_6px,var(--color-border)_6px,var(--color-border)_8px)] px-2 py-1 text-xs text-muted-foreground"
                    style={{
                      top: (Math.max(b.start, rangeStart) - rangeStart) * PX,
                      height: (Math.min(b.end, rangeEnd) - Math.max(b.start, rangeStart)) * PX,
                    }}
                  >
                    {b.label}
                  </div>
                ))}

                {appointments.map((x) => {
                  const { lane, lanes: total } = lanes.get(x)!;
                  return (
                    <AppointmentBlock
                      key={x.a.id}
                      appointment={x.a}
                      color={col.color}
                      style={{
                        top: (x.start - rangeStart) * PX + 1,
                        height: Math.max((x.end - x.start) * PX - 2, 20),
                        left: `calc(${(lane / total) * 100}% + 2px)`,
                        width: `calc(${100 / total}% - 4px)`,
                      }}
                      timeLabel={`${minutesToTime(x.start)}–${minutesToTime(x.end)}`}
                      onClick={() => props.onOpen(x.a.id)}
                    />
                  );
                })}

                {isToday && nowLocal.minute >= rangeStart && nowLocal.minute <= rangeEnd && (
                  <div
                    className="pointer-events-none absolute inset-x-0 z-10 border-t-2 border-red-500"
                    style={{ top: (nowLocal.minute - rangeStart) * PX }}
                  >
                    <span className="absolute -left-1 -top-1.5 size-3 rounded-full bg-red-500" />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AppointmentBlock(props: {
  appointment: AgendaAppointment;
  color: string | null;
  style: React.CSSProperties;
  timeLabel: string;
  onClick: () => void;
}) {
  const a = props.appointment;
  const compact = (props.style.height as number) < 44;
  const name = a.customerName ?? 'Sin registrar';
  return (
    <button
      type="button"
      onClick={props.onClick}
      title={`${props.timeLabel} · ${name} · ${a.services.map((s) => s.name).join(' + ')} · ${APPOINTMENT_STATUS_LABELS[a.status]}`}
      className={cn(
        'absolute z-[5] overflow-hidden rounded-md border border-l-4 px-2 py-1 text-left text-xs shadow-sm transition-shadow hover:shadow-md focus-visible:outline-2',
        STATUS_STYLE[a.status],
      )}
      style={{ ...props.style, borderLeftColor: props.color ?? '#888' }}
    >
      <span className={cn('flex items-center gap-1', compact ? 'truncate' : '')}>
        <span className="font-semibold tabular-nums">{props.timeLabel.split('–')[0]}</span>
        <span className="truncate font-medium">{name}</span>
        {a.status === 'CONFIRMED' && (
          <CheckCircle2 className="size-3 shrink-0 text-success" aria-label="Confirmado" />
        )}
        {a.source === 'ONLINE' && (
          <Globe className="size-3 shrink-0 text-muted-foreground" aria-label="Reserva online" />
        )}
        {a.customerNoShows > 0 && a.status !== 'NO_SHOW' && (
          <AlertTriangle
            className="size-3 shrink-0 text-warning"
            aria-label={`Faltó ${a.customerNoShows} veces`}
          />
        )}
      </span>
      {!compact && (
        <span className="block truncate text-muted-foreground">
          {a.services.map((s) => s.name).join(' + ')}
        </span>
      )}
    </button>
  );
}

/** Hora actual, actualizada cada minuto (línea roja de "ahora"). */
function useNow() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}
