'use client';

import type { SystemHealth } from '@estoicos/shared';
import { AlertTriangle, CheckCircle2, CircleHelp, OctagonAlert } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiClientError } from '@/lib/api/client';

const QUEUE_LABEL: Record<string, string> = {
  system: 'Mantenimiento',
  notifications: 'Avisos a clientes',
  payments: 'Pagos',
};

/**
 * Estado del sistema contado en criollo. Si todo anda, es **una línea**: al dueño de la barbería
 * no le sirve saber cuántos trabajos hay en cada cola. Si algo falla, ahí sí aparece el detalle.
 */
export function SystemHealthCard({ health }: { health: SystemHealth | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  if (!health) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-destructive/50 bg-destructive/5 px-4 py-3 text-sm">
        <OctagonAlert className="size-4 shrink-0 text-destructive" />
        No se pudo consultar el estado del sistema.
      </div>
    );
  }

  const { worker, queues, alerts } = health;
  const atascadas = queues.filter((q) => q.failed > 0 || q.waiting > 20);
  const todoBien = worker.status === 'ok' && alerts.length === 0 && atascadas.length === 0;

  function acknowledge(alertId: string) {
    startTransition(async () => {
      try {
        await api(`/v1/system/alerts/${alertId}/ack`, { method: 'POST', body: {} });
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo marcar la alerta.');
      }
    });
  }

  // Todo en orden: una línea discreta y a otra cosa.
  if (todoBien) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-4 py-3 text-sm shadow-[var(--shadow-card)]">
        <CheckCircle2 className="size-4 shrink-0 text-success" />
        <span className="font-medium">El sistema funciona bien</span>
        <span className="text-muted-foreground">
          Los avisos a los clientes y los cobros se están procesando sin problemas.
        </span>
      </div>
    );
  }

  const workerView = {
    ok: { icon: CheckCircle2, text: 'Los avisos automáticos funcionan', className: 'text-success' },
    down: {
      icon: OctagonAlert,
      text: 'Los avisos automáticos están caídos',
      className: 'text-destructive',
    },
    unknown: {
      icon: CircleHelp,
      text: 'Todavía no hay señales del sistema de avisos',
      className: 'text-muted-foreground',
    },
  }[worker.status];
  const WorkerIcon = workerView.icon;

  return (
    <Card className={worker.status === 'down' ? 'border-destructive/50' : 'border-warning/50'}>
      <CardHeader>
        <CardTitle className="text-lg">Hay algo para mirar</CardTitle>
        <CardDescription>
          {worker.status === 'down'
            ? 'Mientras esto siga así, los recordatorios y las confirmaciones no salen.'
            : 'El sistema sigue andando, pero algo pide atención.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <div className={`flex items-center gap-2 font-medium ${workerView.className}`}>
            <WorkerIcon className="size-4" />
            {workerView.text}
          </div>
          {worker.ageSeconds !== null && worker.status !== 'ok' && (
            <span className="text-muted-foreground">Última señal hace {formatAge(worker.ageSeconds)}</span>
          )}
          {atascadas.map((q) => (
            <span key={q.name} className="tabular-nums text-muted-foreground">
              {QUEUE_LABEL[q.name] ?? q.name}:{' '}
              {q.failed > 0 ? `${q.failed} con error` : `${q.waiting} en espera`}
            </span>
          ))}
        </div>

        {alerts.length > 0 && (
          <ul className="grid gap-2">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className={`flex flex-wrap items-start gap-3 rounded-lg border p-3 ${
                  alert.severity === 'CRITICAL'
                    ? 'border-destructive/50 bg-destructive/5'
                    : 'border-warning/40 bg-warning/5'
                }`}
              >
                <AlertTriangle
                  className={`mt-0.5 size-4 shrink-0 ${
                    alert.severity === 'CRITICAL' ? 'text-destructive' : 'text-warning'
                  }`}
                />
                <div className="grid flex-1 gap-1 text-sm">
                  <span>{alert.message}</span>
                  <span className="text-xs text-muted-foreground">
                    Desde {new Date(alert.firstSeenAt).toLocaleString('es-AR')} · {alert.occurrences}{' '}
                    {alert.occurrences === 1 ? 'vez' : 'veces'}
                  </span>
                </div>
                {alert.acknowledgedAt ? (
                  <Badge variant="outline">Vista</Badge>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending}
                    onClick={() => acknowledge(alert.id)}
                  >
                    Marcar como vista
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function formatAge(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  return `${Math.round(seconds / 3600)} h`;
}
