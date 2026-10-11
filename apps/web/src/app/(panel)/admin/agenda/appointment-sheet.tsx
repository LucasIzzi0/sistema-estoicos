'use client';

import {
  APPOINTMENT_EVENT_LABELS,
  APPOINTMENT_SOURCE_LABELS,
  APPOINTMENT_STATUS_LABELS,
  CANCEL_REASON_LABELS,
  STAFF_CANCEL_REASONS,
  type AppointmentDetail,
  type AppointmentStatus,
  type SaleDetail,
} from '@estoicos/shared';
import { AlertTriangle, Loader2, MessageCircle, Phone, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents, formatDateTime, formatDuration, formatPhone } from '@/lib/format';
import { localTimeOf } from '@/lib/agenda';
import { AppointmentDialog } from './appointment-dialog';
import type { AgendaBarber, AgendaService } from './types';

const TZ = 'America/Argentina/Buenos_Aires';

/** Acciones de estado según el estado actual (la API valida las mismas reglas). */
const ACTIONS: Partial<
  Record<AppointmentStatus, { to: AppointmentStatus; label: string; primary?: boolean }[]>
> = {
  BOOKED: [
    { to: 'IN_PROGRESS', label: 'Llegó: empezar', primary: true },
    { to: 'CONFIRMED', label: 'Marcar confirmado' },
    { to: 'NO_SHOW', label: 'No vino' },
  ],
  CONFIRMED: [
    { to: 'IN_PROGRESS', label: 'Llegó: empezar', primary: true },
    { to: 'NO_SHOW', label: 'No vino' },
  ],
  // "Atendido" lo marca el cobro (Fase 4): se usa el botón "Cobrar".
  IN_PROGRESS: [{ to: 'BOOKED', label: 'Deshacer "en curso"' }],
  COMPLETED: [{ to: 'IN_PROGRESS', label: 'Reabrir' }],
  NO_SHOW: [{ to: 'BOOKED', label: 'Quitar "no vino"' }],
};

export function AppointmentSheet(props: {
  appointmentId: string;
  branchId: string;
  barbers: AgendaBarber[];
  services: AgendaService[];
  canManage: boolean;
  canCharge: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<AppointmentDetail | null>(null);
  const [editing, setEditing] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [pending, startTransition] = useTransition();

  const load = useCallback(async () => {
    setDetail(await api<AppointmentDetail>(`/v1/appointments/${props.appointmentId}`));
  }, [props.appointmentId]);

  useEffect(() => {
    void load().catch(() => toast.error('No se pudo abrir el turno.'));
  }, [load]);

  function run(action: () => Promise<AppointmentDetail>, message: string) {
    startTransition(async () => {
      try {
        setDetail(await action());
        toast.success(message);
        props.onChanged();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  const changeStatus = (to: AppointmentStatus, label: string) =>
    run(
      () =>
        api<AppointmentDetail>(`/v1/appointments/${props.appointmentId}/status`, { body: { status: to } }),
      `${label}: listo.`,
    );

  function charge() {
    startTransition(async () => {
      try {
        const sale = await api<SaleDetail>(`/v1/appointments/${props.appointmentId}/sale`, {
          method: 'POST',
          body: {},
        });
        router.push(`/admin/caja/ventas/${sale.id}`);
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo abrir el cobro.');
      }
    });
  }

  const a = detail;
  const chargeable = a && ['BOOKED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status);
  const movable = a && ['BOOKED', 'CONFIRMED', 'IN_PROGRESS'].includes(a.status);

  return (
    <>
      <Sheet open={!editing} onOpenChange={(open) => !open && props.onClose()}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-md">
          {!a ? (
            <div className="grid h-40 place-items-center">
              <Loader2 className="animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  {localTimeOf(a.startsAt, TZ)}–{localTimeOf(a.endsAt, TZ)}
                  <Badge variant={a.status === 'NO_SHOW' ? 'destructive' : 'secondary'}>
                    {APPOINTMENT_STATUS_LABELS[a.status]}
                  </Badge>
                </SheetTitle>
                <SheetDescription>
                  {formatDateTime(a.startsAt)} · {a.barberName} · {APPOINTMENT_SOURCE_LABELS[a.source]}
                  {a.anyBarberRequested ? ' (eligió “cualquiera”)' : ''}
                </SheetDescription>
              </SheetHeader>

              <div className="grid gap-5 px-4 pb-6">
                <section className="grid gap-1">
                  {a.customerId ? (
                    <Link
                      href={`/admin/clientes/${a.customerId}`}
                      className="text-lg font-semibold hover:underline"
                    >
                      {a.customerName}
                    </Link>
                  ) : (
                    <span className="text-lg font-semibold">Cliente sin registrar</span>
                  )}
                  {a.customerPhone && (
                    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      <a
                        href={`tel:${a.customerPhone}`}
                        className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
                      >
                        <Phone className="size-3.5" /> {formatPhone(a.customerPhone)}
                      </a>
                      {/* Si se está haciendo esperar, lo más rápido es escribirle. */}
                      <a
                        href={`https://wa.me/${a.customerPhone.replace(/\D/g, '')}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground"
                      >
                        <MessageCircle className="size-3.5" /> WhatsApp
                      </a>
                    </span>
                  )}
                  {a.customerNoShows > 0 && (
                    <p className="flex items-center gap-1.5 text-sm text-warning">
                      <AlertTriangle className="size-4" /> Faltó {a.customerNoShows}{' '}
                      {a.customerNoShows === 1 ? 'vez' : 'veces'} sin avisar.
                    </p>
                  )}
                </section>

                <section className="grid gap-1 rounded-lg border p-3 text-sm">
                  {a.services.map((s) => (
                    <p key={s.serviceId} className="flex justify-between gap-2">
                      <span>
                        {s.name}{' '}
                        <span className="text-muted-foreground">· {formatDuration(s.durationMin)}</span>
                      </span>
                      <span className="tabular-nums">{formatCents(s.priceCents)}</span>
                    </p>
                  ))}
                  <p className="flex justify-between border-t pt-1 font-semibold">
                    <span>Total reservado</span>
                    <span className="tabular-nums">{formatCents(a.bookedTotalCents)}</span>
                  </p>
                </section>

                {(a.customerNotes || a.internalNotes) && (
                  <section className="grid gap-2 text-sm">
                    {a.customerNotes && (
                      <p>
                        <span className="text-muted-foreground">Nota del cliente: </span>
                        {a.customerNotes}
                      </p>
                    )}
                    {a.internalNotes && (
                      <p>
                        <span className="text-muted-foreground">Nota interna: </span>
                        {a.internalNotes}
                      </p>
                    )}
                  </section>
                )}

                {a.status === 'CANCELED' && (
                  <p className="text-sm text-muted-foreground">
                    Cancelado: {a.cancelReason ? CANCEL_REASON_LABELS[a.cancelReason] : ''}
                    {a.cancelNote ? ` — ${a.cancelNote}` : ''}
                  </p>
                )}

                {props.canCharge && chargeable && (
                  <Button size="lg" disabled={pending} onClick={charge}>
                    <Wallet /> {a.status === 'COMPLETED' ? 'Ver cobro' : 'Cobrar'}
                  </Button>
                )}

                {props.canManage && (
                  <section className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                      {(ACTIONS[a.status] ?? []).map((action) => (
                        <Button
                          key={action.to}
                          variant={action.primary ? 'default' : 'outline'}
                          disabled={pending}
                          onClick={() => changeStatus(action.to, action.label)}
                        >
                          {action.label}
                        </Button>
                      ))}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {movable && (
                        <Button variant="outline" disabled={pending} onClick={() => setEditing(true)}>
                          {a.status === 'IN_PROGRESS' ? 'Editar servicios' : 'Mover o editar'}
                        </Button>
                      )}
                      {['PENDING_PAYMENT', 'BOOKED', 'CONFIRMED'].includes(a.status) && (
                        <Button
                          variant="ghost"
                          className="text-destructive"
                          disabled={pending}
                          onClick={() => setCanceling((v) => !v)}
                        >
                          Cancelar turno
                        </Button>
                      )}
                    </div>
                    {canceling && (
                      <CancelForm
                        pending={pending}
                        hasCustomer={!!a.customerId}
                        onCancel={(body) =>
                          run(
                            () =>
                              api<AppointmentDetail>(`/v1/appointments/${a.id}/cancel`, { body }).finally(
                                () => setCanceling(false),
                              ),
                            'Turno cancelado.',
                          )
                        }
                      />
                    )}
                  </section>
                )}

                <section className="grid gap-2">
                  <h3 className="text-sm font-semibold">Historial</h3>
                  <ol className="grid gap-2 border-l pl-4 text-sm">
                    {a.events.map((e) => (
                      <li key={e.id} className="grid">
                        <span>
                          {e.type === 'STATUS_CHANGED' && e.toStatus
                            ? `${e.fromStatus ? APPOINTMENT_STATUS_LABELS[e.fromStatus] : ''} → ${APPOINTMENT_STATUS_LABELS[e.toStatus]}`
                            : APPOINTMENT_EVENT_LABELS[e.type]}
                          {e.type === 'RESCHEDULED' && e.previousStartsAt
                            ? ` (antes: ${formatDateTime(e.previousStartsAt)})`
                            : ''}
                          {e.note ? ` — ${e.note}` : ''}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {formatDateTime(e.createdAt)} · {e.actor}
                        </span>
                      </li>
                    ))}
                  </ol>
                </section>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {editing && a && (
        <AppointmentDialog
          mode="edit"
          appointment={a}
          timezone={TZ}
          branchId={props.branchId}
          barbers={props.barbers}
          services={props.services}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
            props.onChanged();
          }}
        />
      )}
    </>
  );
}

function CancelForm(props: {
  pending: boolean;
  hasCustomer: boolean;
  onCancel: (body: { reason: string; note: string | null; notifyCustomer: boolean }) => void;
}) {
  const [reason, setReason] = useState<string>('CUSTOMER_REQUEST');
  const [note, setNote] = useState('');
  const [notify, setNotify] = useState(true);
  return (
    <div className="grid gap-3 rounded-lg border border-destructive/40 p-3">
      <div className="grid gap-1.5">
        <Label htmlFor="cancel-reason">Motivo</Label>
        <Select value={reason} onValueChange={setReason}>
          <SelectTrigger id="cancel-reason" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STAFF_CANCEL_REASONS.map((r) => (
              <SelectItem key={r} value={r}>
                {CANCEL_REASON_LABELS[r]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Textarea
        aria-label="Detalle (opcional)"
        placeholder="Detalle (opcional)"
        rows={2}
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      {props.hasCustomer && (
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={notify} onCheckedChange={(v) => setNotify(v === true)} />
          Avisarle al cliente por email
        </label>
      )}
      <Button
        variant="destructive"
        disabled={props.pending}
        onClick={() => props.onCancel({ reason, note: note.trim() || null, notifyCustomer: notify })}
      >
        Confirmar cancelación
      </Button>
    </div>
  );
}
