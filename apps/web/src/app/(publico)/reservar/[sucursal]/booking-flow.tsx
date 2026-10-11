'use client';

import type { Availability, CustomerMe, MyAppointment, PublicBranch } from '@estoicos/shared';
import { ArrowLeft, Check, CheckCircle2, Clock, Scissors, Shuffle, UserRound } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { EmailCodeForm } from '@/components/auth/email-code-form';
import { dayParts, SlotPicker } from '@/components/booking/slot-picker';
import { ProfileForm } from '@/components/customer/profile-form';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents, formatDuration } from '@/lib/format';
import { cn } from '@/lib/utils';

type Step = 'services' | 'barber' | 'slot' | 'login' | 'profile' | 'confirm' | 'done';
const ANY = 'any';

/**
 * Recorrido de reserva, pensado para el celular y para hacerse en menos de un minuto:
 * servicio(s) → barbero o "cualquiera" → día → horario → email y código → datos (si es nuevo)
 * → confirmación. Los horarios se ven sin loguearse.
 */
export function BookingFlow({ branch, me: initialMe }: { branch: PublicBranch; me: CustomerMe | null }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('services');
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [barberId, setBarberId] = useState<string | null>(null);
  const [slot, setSlot] = useState<{ date: string; time: string } | null>(null);
  const [me, setMe] = useState<CustomerMe | null>(initialMe);
  const [loginStep, setLoginStep] = useState<{ step: 'email' | 'code'; email: string }>({
    step: 'email',
    email: '',
  });
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  const [booked, setBooked] = useState<MyAppointment | null>(null);
  const [pending, startTransition] = useTransition();

  const chosen = branch.services.filter((s) => serviceIds.includes(s.id));
  const totalCents = chosen.reduce((a, s) => a + s.priceCents, 0);
  const totalMin = chosen.reduce((a, s) => a + s.durationMin, 0);
  const barbers = branch.barbers.filter((b) => serviceIds.every((id) => b.serviceIds.includes(id)));
  const barber = branch.barbers.find((b) => b.id === barberId);

  const load = useCallback(
    (from: string, days: number) => {
      const params = new URLSearchParams({ serviceIds: serviceIds.join(','), from, days: String(days) });
      if (barberId && barberId !== ANY) params.set('barberId', barberId);
      return api<Availability>(`/v1/public/branches/${branch.slug}/availability?${params}`);
    },
    [branch.slug, serviceIds, barberId],
  );
  const reloadKey = useMemo(() => `${serviceIds.join(',')}|${barberId}`, [serviceIds, barberId]);

  function toggleService(id: string) {
    setServiceIds((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));
    setSlot(null);
  }

  function afterSlot() {
    setError(null);
    if (!me) setStep('login');
    else if (me.needsProfile) setStep('profile');
    else setStep('confirm');
  }

  function confirm() {
    if (!slot) return;
    setError(null);
    startTransition(async () => {
      try {
        const appointment = await api<MyAppointment>('/v1/me/appointments', {
          body: {
            branchId: branch.id,
            serviceIds,
            barberId: barberId === ANY ? null : barberId,
            date: slot.date,
            time: slot.time,
            notes: notes.trim() || null,
          },
        });
        setBooked(appointment);
        setStep('done');
        router.refresh();
      } catch (e) {
        const err =
          e instanceof ApiClientError
            ? { message: e.message, code: e.code }
            : { message: 'No se pudo reservar. Probá de nuevo.', code: 'ERROR' };
        if (err.code === 'SLOT_TAKEN') {
          toast.error(err.message);
          setSlot(null);
          setStep('slot');
          return;
        }
        if (err.code === 'PROFILE_REQUIRED') {
          setStep('profile');
          return;
        }
        setError(err);
      }
    });
  }

  const back: Partial<Record<Step, Step>> = {
    barber: 'services',
    slot: 'barber',
    login: 'slot',
    profile: 'slot',
    confirm: 'slot',
  };

  if (step === 'done' && booked) {
    return <BookedCard appointment={booked} />;
  }

  return (
    <div className="grid gap-5">
      <Progress step={step} />
      {back[step] && (
        <button
          type="button"
          onClick={() => setStep(back[step]!)}
          className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" /> Volver
        </button>
      )}

      {step === 'services' && (
        <section className="grid gap-3">
          <h2 className="text-lg font-bold">¿Qué te querés hacer?</h2>
          {branch.services.length === 0 && (
            <p className="text-sm text-muted-foreground">Todavía no hay servicios para reservar online.</p>
          )}
          <div className="grid gap-2">
            {branch.services.map((s) => {
              const on = serviceIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleService(s.id)}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                    on ? 'border-primary bg-primary/5' : 'hover:border-foreground/40',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-5 shrink-0 place-items-center rounded border',
                      on && 'border-primary bg-primary text-primary-foreground',
                    )}
                  >
                    {on && <Check className="size-3.5" />}
                  </span>
                  <span className="grid flex-1 gap-0.5">
                    <span className="font-medium">{s.name}</span>
                    {s.description && <span className="text-xs text-muted-foreground">{s.description}</span>}
                    <span className="text-xs text-muted-foreground">{formatDuration(s.durationMin)}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatCents(s.priceCents)}</span>
                </button>
              );
            })}
          </div>
          <StickyAction
            disabled={!serviceIds.length}
            onClick={() => setStep('barber')}
            summary={
              chosen.length ? `${formatDuration(totalMin)} · ${formatCents(totalCents)}` : 'Elegí uno o más'
            }
          >
            Continuar
          </StickyAction>
        </section>
      )}

      {step === 'barber' && (
        <section className="grid gap-3">
          <h2 className="text-lg font-bold">¿Con quién?</h2>
          <div className="grid gap-2">
            {branch.rules.allowAnyBarber && barbers.length > 1 && (
              <ChoiceCard
                icon={<Shuffle className="size-5" />}
                title="Cualquier barbero"
                subtitle="Te mostramos todos los horarios libres"
                onClick={() => {
                  setBarberId(ANY);
                  setSlot(null);
                  setStep('slot');
                }}
              />
            )}
            {barbers.map((b) => (
              <ChoiceCard
                key={b.id}
                icon={
                  <span
                    className="grid size-9 place-items-center rounded-full text-sm font-bold text-white"
                    style={{ background: b.color ?? '#555' }}
                  >
                    {b.displayName.slice(0, 1)}
                  </span>
                }
                title={b.displayName}
                subtitle={b.bio ?? undefined}
                onClick={() => {
                  setBarberId(b.id);
                  setSlot(null);
                  setStep('slot');
                }}
              />
            ))}
            {!barbers.length && (
              <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                Ningún barbero hace todos los servicios elegidos juntos. Probá sacando alguno.
              </p>
            )}
          </div>
        </section>
      )}

      {step === 'slot' && (
        <section className="grid gap-3">
          <h2 className="text-lg font-bold">¿Cuándo?</h2>
          <p className="text-sm text-muted-foreground">
            {chosen.map((s) => s.name).join(' + ')} ·{' '}
            {barber ? `con ${barber.displayName}` : 'cualquier barbero'}
          </p>
          <SlotPicker
            timezone={branch.timezone}
            load={load}
            reloadKey={reloadKey}
            selected={slot}
            onSelect={({ date, time }) => setSlot({ date, time })}
          />
          <StickyAction
            disabled={!slot}
            onClick={afterSlot}
            summary={slot ? `${dayParts(slot.date).long}, ${slot.time}` : 'Elegí un horario'}
          >
            Continuar
          </StickyAction>
        </section>
      )}

      {step === 'login' && (
        <section className="grid gap-3">
          <h2 className="text-lg font-bold">
            {loginStep.step === 'email' ? 'Tu email para confirmar' : 'Revisá tu email'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {loginStep.step === 'email'
              ? 'Te mandamos un código de 6 números. Sin contraseñas.'
              : `Escribí el código que te mandamos a ${loginStep.email}.`}
          </p>
          <EmailCodeForm
            onStepChange={(s, email) => setLoginStep({ step: s, email })}
            onVerified={(customer) => {
              setMe(customer);
              setStep(customer.needsProfile ? 'profile' : 'confirm');
            }}
          />
        </section>
      )}

      {step === 'profile' && me && (
        <section className="grid gap-3">
          <h2 className="text-lg font-bold">Tus datos</h2>
          <p className="text-sm text-muted-foreground">
            Una sola vez, para avisarte de tu turno y reconocerte en el local.
          </p>
          <ProfileForm
            initial={me}
            submitLabel="Continuar"
            onSaved={(updated) => {
              setMe(updated);
              setStep('confirm');
            }}
          />
        </section>
      )}

      {step === 'confirm' && slot && (
        <section className="grid gap-4">
          <h2 className="text-lg font-bold">Confirmá tu turno</h2>
          <Summary
            rows={[
              [<Clock key="c" className="size-4" />, `${dayParts(slot.date).long}, ${slot.time} h`],
              [<Scissors key="s" className="size-4" />, chosen.map((s) => s.name).join(' + ')],
              [<UserRound key="u" className="size-4" />, barber ? barber.displayName : 'Cualquier barbero'],
            ]}
            total={`${formatDuration(totalMin)} · ${formatCents(totalCents)}`}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="notes">¿Algo que debamos saber? (opcional)</Label>
            <Textarea
              id="notes"
              maxLength={300}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej.: vengo con mi hijo"
            />
          </div>
          {error && (
            <div className="grid gap-2 rounded-lg border border-destructive/40 p-3 text-sm" role="alert">
              <p className="text-destructive">{error.message}</p>
              {error.code === 'TOO_MANY_ACTIVE' && (
                <Link href="/mi-cuenta/turnos" className="font-medium underline underline-offset-4">
                  Ver mis turnos
                </Link>
              )}
            </div>
          )}
          <Button size="lg" onClick={confirm} disabled={pending}>
            {pending ? 'Reservando…' : 'Confirmar turno'}
          </Button>
          {me && (
            <p className="text-center text-xs text-muted-foreground">
              Reservás como {me.firstName} {me.lastName} ({me.email}).
            </p>
          )}
        </section>
      )}
    </div>
  );
}

const STEPS: { key: Step[]; label: string }[] = [
  { key: ['services'], label: 'Servicio' },
  { key: ['barber'], label: 'Barbero' },
  { key: ['slot'], label: 'Horario' },
  { key: ['login', 'profile', 'confirm'], label: 'Confirmar' },
];

function Progress({ step }: { step: Step }) {
  const current = STEPS.findIndex((s) => s.key.includes(step));
  return (
    <ol className="grid grid-cols-4 gap-1.5" aria-label="Pasos de la reserva">
      {STEPS.map((s, i) => (
        <li key={s.label} className="grid gap-1" aria-current={i === current ? 'step' : undefined}>
          <span className={cn('h-1 rounded-full', i <= current ? 'bg-primary' : 'bg-muted')} />
          <span className={cn('text-[11px]', i === current ? 'font-medium' : 'text-muted-foreground')}>
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ChoiceCard(props: { icon: React.ReactNode; title: string; subtitle?: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex items-center gap-3 rounded-lg border p-3 text-left transition-colors hover:border-foreground/40"
    >
      <span className="grid size-9 shrink-0 place-items-center text-muted-foreground">{props.icon}</span>
      <span className="grid gap-0.5">
        <span className="font-medium">{props.title}</span>
        {props.subtitle && <span className="text-xs text-muted-foreground">{props.subtitle}</span>}
      </span>
    </button>
  );
}

/** Botón principal fijo abajo en el celular, con el resumen de lo elegido. */
function StickyAction(props: {
  disabled: boolean;
  onClick: () => void;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <div className="sticky bottom-0 -mx-4 mt-2 flex items-center gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur">
      <span className="flex-1 text-sm text-muted-foreground first-letter:uppercase">{props.summary}</span>
      <Button size="lg" disabled={props.disabled} onClick={props.onClick}>
        {props.children}
      </Button>
    </div>
  );
}

function Summary(props: { rows: [React.ReactNode, string][]; total: string }) {
  return (
    <div className="grid gap-2 rounded-lg border p-4">
      {props.rows.map(([icon, text]) => (
        <p key={text} className="flex items-center gap-2 text-sm first-letter:uppercase">
          <span className="text-muted-foreground">{icon}</span>
          <span className="first-letter:uppercase">{text}</span>
        </p>
      ))}
      <p className="border-t pt-2 text-sm font-semibold">{props.total}</p>
    </div>
  );
}

function BookedCard({ appointment: a }: { appointment: MyAppointment }) {
  const when = new Date(a.startsAt).toLocaleString('es-AR', {
    timeZone: a.timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return (
    <div className="grid gap-5 text-center">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-success/10">
        <CheckCircle2 className="size-9 text-success" />
      </span>
      <div className="grid gap-1">
        <h2 className="text-2xl font-extrabold uppercase">¡Turno reservado!</h2>
        <p className="text-muted-foreground">Te mandamos la confirmación por email.</p>
      </div>
      <div className="grid gap-1 rounded-xl border bg-card p-4 text-left text-sm shadow-[var(--shadow-card)]">
        <p className="font-semibold first-letter:uppercase">{when.replace(',', '')} h</p>
        <p>{a.services.map((s) => s.name).join(' + ')}</p>
        <p className="text-muted-foreground">
          Con {a.barberName} · {a.branchName}
          {a.branchAddress ? `, ${a.branchAddress}` : ''}
        </p>
      </div>
      <Button asChild size="lg" variant="outline">
        <Link href="/mi-cuenta/turnos">Ver mis turnos</Link>
      </Button>
    </div>
  );
}
