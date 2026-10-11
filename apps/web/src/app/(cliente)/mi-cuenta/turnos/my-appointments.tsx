'use client';

import {
  APPOINTMENT_STATUS_LABELS,
  type Availability,
  type MyAppointment,
  type MyAppointments,
} from '@estoicos/shared';
import { CalendarPlus, Clock, MapPin } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { dayParts, SlotPicker } from '@/components/booking/slot-picker';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents } from '@/lib/format';

function when(a: MyAppointment) {
  return new Date(a.startsAt)
    .toLocaleString('es-AR', {
      timeZone: a.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    })
    .replace(',', '');
}

function deadline(a: MyAppointment) {
  return new Date(a.changeDeadline).toLocaleString('es-AR', {
    timeZone: a.timezone,
    weekday: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** Próximos turnos (cancelar o reprogramar hasta N horas antes) e historial. */
export function MyAppointmentsList({ data }: { data: MyAppointments }) {
  const [rescheduling, setRescheduling] = useState<MyAppointment | null>(null);
  const [canceling, setCanceling] = useState<MyAppointment | null>(null);

  return (
    <div className="grid gap-8">
      <section className="grid gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold">Próximos</h2>
          <Button asChild size="sm">
            <Link href="/mi-cuenta/reservar">
              <CalendarPlus /> Reservar
            </Link>
          </Button>
        </div>
        {data.upcoming.length === 0 ? (
          <div className="grid justify-items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-muted text-muted-foreground">
              <CalendarPlus className="size-5" />
            </span>
            <p className="font-heading text-base font-semibold">No tenés turnos reservados</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Elegí qué te querés hacer y con quién: te lleva menos de un minuto.
            </p>
            <Button asChild className="mt-1">
              <Link href="/mi-cuenta/reservar">Reservar un turno</Link>
            </Button>
          </div>
        ) : (
          data.upcoming.map((a, index) => (
            <article
              key={a.id}
              className={
                index === 0
                  ? 'grid gap-3 rounded-xl border border-primary/30 bg-card p-4 shadow-[var(--shadow-card)] ring-1 ring-primary/10'
                  : 'grid gap-3 rounded-xl border bg-card p-4 shadow-[var(--shadow-card)]'
              }
            >
              <div className="flex items-start justify-between gap-3">
                <div className="grid gap-1">
                  {index === 0 && (
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
                      Tu próximo turno
                    </span>
                  )}
                  <p className="font-heading text-lg font-bold first-letter:uppercase">{when(a)} h</p>
                  <p className="text-sm">{a.services.map((s) => s.name).join(' + ')}</p>
                  <p className="text-sm text-muted-foreground">Con {a.barberName}</p>
                </div>
                <Badge variant="secondary">{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
              </div>
              <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <MapPin className="size-4" />
                {a.branchName}
                {a.branchAddress ? `, ${a.branchAddress}` : ''}
              </p>
              {(a.canChange || a.canCancel) && (
                <div className="flex flex-wrap items-center gap-2">
                  {a.canChange && (
                    <Button variant="outline" size="sm" onClick={() => setRescheduling(a)}>
                      Cambiar horario
                    </Button>
                  )}
                  {a.canCancel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setCanceling(a)}
                    >
                      Cancelar turno
                    </Button>
                  )}
                </div>
              )}
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="size-3.5" />
                {a.canChange
                  ? `Podés cambiar el horario hasta el ${deadline(a)} h.`
                  : 'Ya no se puede cambiar el horario desde acá: comunicate con la barbería.'}
              </p>
            </article>
          ))
        )}
      </section>

      {data.past.length > 0 && (
        <section className="grid gap-2">
          <h2 className="text-lg font-bold">Anteriores</h2>
          <ul className="divide-y rounded-xl border">
            {data.past.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                <span className="grid">
                  <span className="first-letter:uppercase">{when(a)} h</span>
                  <span className="text-muted-foreground">
                    {a.services.map((s) => s.name).join(' + ')} · {a.barberName}
                  </span>
                </span>
                <span className="grid justify-items-end gap-1">
                  <Badge variant="outline">{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
                  <span className="tabular-nums text-muted-foreground">{formatCents(a.totalCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rescheduling && <RescheduleDialog appointment={rescheduling} onClose={() => setRescheduling(null)} />}
      {canceling && <CancelDialog appointment={canceling} onClose={() => setCanceling(null)} />}
    </div>
  );
}

function RescheduleDialog({ appointment: a, onClose }: { appointment: MyAppointment; onClose: () => void }) {
  const router = useRouter();
  const [slot, setSlot] = useState<{ date: string; time: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(
    (from: string, days: number) =>
      api<Availability>(`/v1/me/appointments/${a.id}/availability?from=${from}&days=${days}`),
    [a.id],
  );

  function save() {
    if (!slot) return;
    startTransition(async () => {
      try {
        await api(`/v1/me/appointments/${a.id}/reschedule`, { body: slot });
        toast.success('Listo, cambiamos tu turno. Te mandamos la confirmación por email.');
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo cambiar el turno.');
        setSlot(null);
        setReloadKey((k) => k + 1);
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cambiar horario</DialogTitle>
          <DialogDescription>
            {a.services.map((s) => s.name).join(' + ')} con {a.barberName}. Ahora: {when(a)} h.
          </DialogDescription>
        </DialogHeader>
        <SlotPicker
          timezone={a.timezone}
          load={load}
          reloadKey={String(reloadKey)}
          selected={slot}
          onSelect={({ date, time }) => setSlot({ date, time })}
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Volver
          </Button>
          <Button disabled={!slot || pending} onClick={save}>
            {pending
              ? 'Guardando…'
              : slot
                ? `Cambiar al ${dayParts(slot.date).day}, ${slot.time} h`
                : 'Elegí un horario'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CancelDialog({ appointment: a, onClose }: { appointment: MyAppointment; onClose: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  function cancel() {
    startTransition(async () => {
      try {
        await api(`/v1/me/appointments/${a.id}/cancel`, { method: 'POST', body: {} });
        toast.success('Turno cancelado. ¡Gracias por avisar!');
        onClose();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo cancelar.');
      }
    });
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>¿Cancelar el turno?</DialogTitle>
          <DialogDescription>
            {when(a)} h con {a.barberName}. El horario queda libre para otra persona.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            No, mantenerlo
          </Button>
          <Button variant="destructive" disabled={pending} onClick={cancel}>
            {pending ? 'Cancelando…' : 'Sí, cancelar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
