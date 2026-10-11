'use client';

import { addDays, type Agenda } from '@estoicos/shared';
import { CalendarPlus, ChevronLeft, ChevronRight, DoorOpen, RefreshCw, UserCog } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { dayParts } from '@/components/booking/slot-picker';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { api } from '@/lib/api/client';
import { weekStart } from '@/lib/agenda';
import { AgendaGrid, type AgendaColumn } from './agenda-grid';
import { AppointmentDialog } from './appointment-dialog';
import { AppointmentSheet } from './appointment-sheet';
import type { AgendaBarber, AgendaService, NewAppointmentDraft } from './types';
import { WalkInDialog } from './walk-in-dialog';

type View = 'day' | 'week';

/**
 * Tablero de la agenda. Se actualiza solo cada 30 segundos (así recepción ve las reservas
 * online sin recargar) y la URL guarda día, vista y barbero para compartir o volver.
 */
export function AgendaBoard(props: {
  branchId: string;
  branchName: string;
  initial: Agenda;
  allBarbers: AgendaBarber[];
  initialDate: string;
  initialView: View;
  initialBarberId: string | null;
  today: string;
  services: AgendaService[];
  canManage: boolean;
  canCharge: boolean;
}) {
  const { branchId, today } = props;
  const [agenda, setAgenda] = useState(props.initial);
  const [date, setDate] = useState(props.initialDate);
  const [view, setView] = useState<View>(props.initialView);
  const [barberId, setBarberId] = useState(props.initialBarberId);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<NewAppointmentDraft | null>(null);
  const [walkIn, setWalkIn] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const params =
        view === 'week' && barberId
          ? `date=${weekStart(date)}&days=7&barberId=${barberId}`
          : `date=${date}&days=1`;
      const data = await api<Agenda>(`/v1/branches/${branchId}/agenda?${params}`);
      if (id === requestId.current) setAgenda(data);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [branchId, date, view, barberId]);

  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void refresh();
    const url = new URL(window.location.href);
    url.searchParams.set('fecha', date);
    url.searchParams.set('vista', view === 'week' ? 'semana' : 'dia');
    if (barberId) url.searchParams.set('barbero', barberId);
    window.history.replaceState(null, '', url);
  }, [refresh, date, view, barberId]);

  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !draft && !walkIn) void refresh();
    }, 30_000);
    return () => clearInterval(timer);
  }, [refresh, draft, walkIn]);

  const step = view === 'week' ? 7 : 1;
  const tz = agenda.timezone;
  const columns: AgendaColumn[] =
    view === 'day'
      ? agenda.barbers.map((b) => ({
          key: b.id,
          title: b.displayName,
          color: b.color,
          barberId: b.id,
          date: agenda.from,
        }))
      : Array.from({ length: agenda.days }, (_, i) => {
          const d = addDays(agenda.from, i);
          const p = dayParts(d);
          const barber = agenda.barbers[0];
          return {
            key: d,
            title: `${p.weekday} ${p.day}`,
            subtitle: d === today ? 'Hoy' : undefined,
            color: barber?.color ?? null,
            barberId: barber?.id ?? '',
            date: d,
          };
        });

  const title =
    view === 'day'
      ? dayParts(date).long
      : `Semana del ${dayParts(weekStart(date)).day} de ${dayParts(weekStart(date)).month}`;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-2xl font-extrabold uppercase first-letter:uppercase md:text-3xl">
          {title}
        </h1>
        {props.canManage && (
          <>
            <Button variant="outline" onClick={() => setWalkIn(true)}>
              <DoorOpen /> Sin turno
            </Button>
            <Button
              onClick={() =>
                setDraft({
                  barberId: barberId ?? agenda.barbers[0]?.id ?? '',
                  date: view === 'day' ? date : today,
                  time: '',
                })
              }
            >
              <CalendarPlus /> Nuevo turno
            </Button>
          </>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="icon"
            aria-label="Anterior"
            onClick={() => setDate(addDays(date, -step))}
          >
            <ChevronLeft />
          </Button>
          <Button variant="outline" onClick={() => setDate(today)} disabled={date === today}>
            Hoy
          </Button>
          <Button
            variant="outline"
            size="icon"
            aria-label="Siguiente"
            onClick={() => setDate(addDays(date, step))}
          >
            <ChevronRight />
          </Button>
        </div>
        <Input
          type="date"
          aria-label="Ir a la fecha"
          className="w-40"
          value={date}
          onChange={(e) => e.target.value && setDate(e.target.value)}
        />
        <ToggleGroup
          type="single"
          variant="outline"
          value={view}
          onValueChange={(v) => v && setView(v as View)}
          aria-label="Vista"
        >
          <ToggleGroupItem value="day">Día</ToggleGroupItem>
          <ToggleGroupItem value="week">Semana</ToggleGroupItem>
        </ToggleGroup>
        {view === 'week' && (
          <Select value={barberId ?? undefined} onValueChange={setBarberId}>
            <SelectTrigger className="w-40" aria-label="Barbero">
              <SelectValue placeholder="Barbero" />
            </SelectTrigger>
            <SelectContent>
              {props.allBarbers.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.displayName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Actualizar"
          className="ml-auto"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} />
        </Button>
      </div>

      {agenda.closures.length > 0 && (
        <p className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          Sucursal cerrada: {agenda.closures.map((c) => c.reason).join(', ')}
        </p>
      )}

      {columns.length === 0 ? (
        <div className="grid justify-items-center gap-3 rounded-xl border border-dashed px-6 py-12 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
            <UserCog className="size-5" />
          </span>
          <p className="font-heading text-base font-semibold">Todavía no hay barberos</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Sin barberos activos en {props.branchName} no hay agenda que mostrar.
          </p>
          <Button asChild variant="outline" className="mt-1">
            <Link href="/admin/barberos">Cargar barberos</Link>
          </Button>
        </div>
      ) : (
        <AgendaGrid
          agenda={agenda}
          columns={columns}
          timezone={tz}
          today={today}
          onOpen={setOpenId}
          onEmptyClick={
            props.canManage
              ? (column, time) => setDraft({ barberId: column.barberId, date: column.date, time })
              : undefined
          }
        />
      )}

      {draft && (
        <AppointmentDialog
          mode="create"
          branchId={branchId}
          barbers={props.allBarbers}
          services={props.services}
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={(id) => {
            setDraft(null);
            void refresh();
            setOpenId(id);
          }}
        />
      )}
      {walkIn && (
        <WalkInDialog
          branchId={branchId}
          barbers={props.allBarbers}
          services={props.services}
          onClose={() => setWalkIn(false)}
          onSaved={() => {
            setWalkIn(false);
            void refresh();
          }}
        />
      )}
      {openId && (
        <AppointmentSheet
          appointmentId={openId}
          branchId={branchId}
          barbers={props.allBarbers}
          services={props.services}
          canManage={props.canManage}
          canCharge={props.canCharge}
          onClose={() => setOpenId(null)}
          onChanged={() => void refresh()}
        />
      )}
    </div>
  );
}
