'use client';

import type { AppointmentDetail, Availability } from '@estoicos/shared';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiClientError } from '@/lib/api/client';
import { localDateOf, localTimeOf, QUARTER_HOURS } from '@/lib/agenda';
import { cn } from '@/lib/utils';
import { CustomerPicker, type PickedCustomer } from '@/components/customer/customer-picker';
import { ServiceChecklist } from './service-checklist';
import type { AgendaBarber, AgendaService, NewAppointmentDraft } from './types';

type Props = {
  branchId: string;
  barbers: AgendaBarber[];
  services: AgendaService[];
  onClose: () => void;
  onSaved: (appointmentId: string) => void;
} & (
  | { mode: 'create'; draft: NewAppointmentDraft }
  | { mode: 'edit'; appointment: AppointmentDetail; timezone: string }
);

/**
 * Nuevo turno o mover/editar uno existente. Muestra los horarios libres del barbero ese día;
 * si se elige una hora fuera de su horario, la API pide confirmación ("Agendar igual").
 * Pisar otro turno no se puede nunca.
 */
export function AppointmentDialog(props: Props) {
  const editing = props.mode === 'edit' ? props.appointment : null;
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [serviceIds, setServiceIds] = useState<string[]>(
    editing ? editing.services.map((s) => s.serviceId) : [],
  );
  const [barberId, setBarberId] = useState(
    editing ? editing.barberId : props.mode === 'create' ? props.draft.barberId : '',
  );
  const [date, setDate] = useState(
    editing && props.mode === 'edit'
      ? localDateOf(editing.startsAt, props.timezone)
      : props.mode === 'create'
        ? props.draft.date
        : '',
  );
  const [time, setTime] = useState(
    editing && props.mode === 'edit'
      ? localTimeOf(editing.startsAt, props.timezone)
      : props.mode === 'create'
        ? props.draft.time
        : '',
  );
  const [notes, setNotes] = useState(editing?.internalNotes ?? '');
  const [free, setFree] = useState<string[] | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Horarios libres del barbero ese día (sin contar el propio turno al moverlo).
  useEffect(() => {
    if (!serviceIds.length || !barberId || !date) {
      setFree(null);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ serviceIds: serviceIds.join(','), barberId, from: date, days: '1' });
    if (editing) params.set('excludeAppointmentId', editing.id);
    api<Availability>(`/v1/branches/${props.branchId}/availability?${params}`)
      .then((a) => !cancelled && setFree(a.days[0]?.slots.map((s) => s.time) ?? []))
      .catch(() => !cancelled && setFree(null));
    return () => {
      cancelled = true;
    };
  }, [serviceIds, barberId, date, editing, props.branchId]);

  // Si cambia algo del horario, la advertencia anterior ya no aplica.
  useEffect(() => setWarning(null), [serviceIds, barberId, date, time]);

  const hasOptions = QUARTER_HOURS.includes(time) || !time;
  const timeOptions = hasOptions ? QUARTER_HOURS : [time, ...QUARTER_HOURS];

  function submit(force = false) {
    setError(null);
    startTransition(async () => {
      try {
        const saved = editing
          ? await api<AppointmentDetail>(`/v1/appointments/${editing.id}`, {
              method: 'PATCH',
              body: { barberId, date, time, serviceIds, internalNotes: notes.trim() || null, force },
            })
          : await api<AppointmentDetail>(`/v1/branches/${props.branchId}/appointments`, {
              body: {
                barberId,
                customerId: customer?.id,
                serviceIds,
                date,
                time,
                internalNotes: notes.trim() || null,
                force,
              },
            });
        toast.success(editing ? 'Turno actualizado.' : 'Turno agendado.');
        props.onSaved(saved.id);
      } catch (e) {
        if (e instanceof ApiClientError && e.code === 'OUTSIDE_SCHEDULE') setWarning(e.message);
        else setError(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  const ready = (editing || customer) && serviceIds.length && barberId && date && time;

  return (
    <Dialog open onOpenChange={(open) => !open && props.onClose()}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{editing ? 'Editar o mover turno' : 'Nuevo turno'}</DialogTitle>
          <DialogDescription>
            {editing
              ? `${editing.customerName ?? 'Sin registrar'}. Si cambia el horario, le avisamos por email.`
              : 'Al agendarlo le llega la confirmación por email al cliente.'}
          </DialogDescription>
        </DialogHeader>

        {/* Fuera del <form>: el alta de cliente tiene su propio formulario. */}
        {!editing && (
          <div className="grid gap-1.5">
            <Label>Cliente</Label>
            <CustomerPicker value={customer} onChange={setCustomer} />
          </div>
        )}
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-1.5">
            <Label>Servicios</Label>
            <ServiceChecklist services={props.services} value={serviceIds} onChange={setServiceIds} />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 grid gap-1.5 sm:col-span-1">
              <Label htmlFor="barber">Barbero</Label>
              <Select value={barberId} onValueChange={setBarberId}>
                <SelectTrigger id="barber" className="w-full">
                  <SelectValue placeholder="Elegí" />
                </SelectTrigger>
                <SelectContent>
                  {props.barbers.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="date">Día</Label>
              <Input id="date" type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="time">Hora</Label>
              <Select value={time || undefined} onValueChange={setTime}>
                <SelectTrigger id="time" className="w-full">
                  <SelectValue placeholder="--:--" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {timeOptions.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {free && (
            <div className="grid gap-1.5">
              <span className="text-xs text-muted-foreground">
                {free.length
                  ? 'Horarios libres ese día:'
                  : 'No quedan horarios libres ese día (podés agendar igual fuera de horario).'}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {free.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setTime(t)}
                    className={cn(
                      'rounded border px-2 py-1 text-xs tabular-nums',
                      t === time
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'hover:border-foreground/40',
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="notes">Nota interna</Label>
            <Textarea
              id="notes"
              maxLength={500}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Solo la ve el staff"
            />
          </div>

          {warning && (
            <div
              className="grid gap-2 rounded-md border border-warning/50 bg-warning/10 p-3 text-sm"
              role="alert"
            >
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
                {warning}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={pending}
                onClick={() => submit(true)}
              >
                Agendar igual
              </Button>
            </div>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={props.onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!ready || pending}>
              {pending ? 'Guardando…' : editing ? 'Guardar cambios' : 'Agendar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
