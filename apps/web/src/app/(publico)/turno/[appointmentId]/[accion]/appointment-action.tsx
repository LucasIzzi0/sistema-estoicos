'use client';

import { CalendarX2, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { api, ApiClientError } from '@/lib/api/client';

type State =
  | { name: 'loading' }
  | { name: 'confirmed'; when: string; branchName: string; barberName: string }
  | { name: 'canceled' }
  | { name: 'error'; message: string };

/** Confirma o cancela el turno apenas se abre el link (un toque desde el recordatorio). */
export function AppointmentAction(props: {
  appointmentId: string;
  action: 'confirm' | 'cancel';
  token: string;
}) {
  const [state, setState] = useState<State>({ name: 'loading' });

  useEffect(() => {
    if (!props.token) {
      setState({ name: 'error', message: 'Ese link está incompleto. Entrá a tu cuenta para ver el turno.' });
      return;
    }
    let cancelled = false;
    const url = `/v1/public/appointments/${props.appointmentId}/${props.action === 'confirm' ? 'confirm' : 'cancel'}?t=${encodeURIComponent(props.token)}`;
    api<{ startsAt?: string; branchName?: string; barberName?: string }>(url, { method: 'POST', body: {} })
      .then((result) => {
        if (cancelled) return;
        if (props.action === 'cancel') return setState({ name: 'canceled' });
        setState({
          name: 'confirmed',
          when: new Date(result.startsAt!).toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Buenos_Aires',
            weekday: 'long',
            day: 'numeric',
            month: 'long',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false,
          }),
          branchName: result.branchName ?? '',
          barberName: result.barberName ?? '',
        });
      })
      .catch((error) => {
        if (cancelled) return;
        setState({
          name: 'error',
          message: error instanceof ApiClientError ? error.message : 'No pudimos procesar el pedido.',
        });
      });
    return () => {
      cancelled = true;
    };
  }, [props.appointmentId, props.action, props.token]);

  if (state.name === 'loading') {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="size-5 animate-spin" /> Un segundo…
      </p>
    );
  }

  if (state.name === 'error') {
    return (
      <div className="grid justify-items-center gap-4 text-center">
        <XCircle className="size-12 text-destructive" />
        <p>{state.message}</p>
        <Button asChild variant="outline">
          <Link href="/mi-cuenta/turnos">Ver mis turnos</Link>
        </Button>
      </div>
    );
  }

  if (state.name === 'canceled') {
    return (
      <div className="grid justify-items-center gap-4 text-center">
        <CalendarX2 className="size-12 text-muted-foreground" />
        <h1 className="text-2xl font-extrabold uppercase">Turno cancelado</h1>
        <p className="text-muted-foreground">Gracias por avisar: le dejás el lugar a otra persona.</p>
        <Button asChild size="lg">
          <Link href="/mi-cuenta/reservar">Reservar otro turno</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid justify-items-center gap-4 text-center">
      <CheckCircle2 className="size-12 text-success" />
      <h1 className="text-2xl font-extrabold uppercase">¡Listo, te esperamos!</h1>
      <p className="first-letter:uppercase">{state.when.replace(',', '')} h</p>
      <p className="text-muted-foreground">
        Con {state.barberName} en {state.branchName}.
      </p>
      <Button asChild variant="outline">
        <Link href="/mi-cuenta/turnos">Ver mis turnos</Link>
      </Button>
    </div>
  );
}
