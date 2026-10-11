'use client';

import { MP_TERMINAL_MODE_LABELS, type MpTerminalDto } from '@estoicos/shared';
import { RefreshCw, Smartphone } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api, ApiClientError } from '@/lib/api/client';

/**
 * Terminales Point. Para que reciban nuestros cobros tienen que estar en **modo PDV** y, después
 * de cambiarlo, hay que **reiniciar la terminal** (es una regla de Mercado Pago).
 */
export function TerminalsCard(props: {
  terminals: MpTerminalDto[];
  branches: { id: string; name: string }[];
  canConnect: boolean;
  accountStatus: string;
}) {
  const router = useRouter();
  const [terminals, setTerminals] = useState(props.terminals);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<MpTerminalDto[]>, success: string) {
    startTransition(async () => {
      try {
        setTerminals(await action());
        toast.success(success);
        // El resumen de la cuenta (cuántas terminales tiene) se vuelve a leer del servidor.
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Smartphone className="size-5" /> Terminales Point
          </CardTitle>
          <CardDescription>
            Para cobrar desde el sistema, la terminal tiene que estar en modo PDV. Después de activarlo,{' '}
            <strong>reiniciala</strong>.
          </CardDescription>
        </div>
        {props.canConnect && (
          <Button
            variant="outline"
            size="sm"
            disabled={pending || props.accountStatus !== 'ACTIVE'}
            onClick={() =>
              run(
                () => api<MpTerminalDto[]>('/v1/mercadopago/terminals/sync', { body: {} }),
                'Terminales actualizadas.',
              )
            }
          >
            <RefreshCw className={pending ? 'animate-spin' : undefined} /> Traer de Mercado Pago
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {terminals.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Todavía no hay terminales. Tocá “Traer de Mercado Pago” para buscarlas.
          </p>
        ) : (
          <ul className="divide-y">
            {terminals.map((t) => (
              <li key={t.id} className="grid gap-3 py-3 sm:grid-cols-[1fr_auto] sm:items-center">
                <div className="grid gap-1">
                  <span className="flex flex-wrap items-center gap-2 font-medium">
                    {t.label ?? t.externalId}
                    <Badge variant={t.operatingMode === 'PDV' ? 'secondary' : 'outline'}>
                      {MP_TERMINAL_MODE_LABELS[t.operatingMode]}
                    </Badge>
                    {t.busy && <Badge>Cobrando</Badge>}
                    {!t.active && <Badge variant="outline">Inactiva</Badge>}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t.externalId}
                    {t.branchName ? ` · ${t.branchName}` : ' · sin sucursal'}
                  </span>
                </div>
                {props.canConnect && (
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label={`Nombre de ${t.externalId}`}
                      placeholder="Ej.: Mostrador"
                      className="w-32"
                      defaultValue={t.label ?? ''}
                      onBlur={(e) => {
                        if (e.target.value === (t.label ?? '')) return;
                        run(
                          () =>
                            api<MpTerminalDto[]>(`/v1/mercadopago/terminals/${t.id}`, {
                              method: 'PATCH',
                              body: { label: e.target.value || null },
                            }),
                          'Nombre guardado.',
                        );
                      }}
                    />
                    <Select
                      value={t.branchId ?? 'none'}
                      onValueChange={(v) =>
                        run(
                          () =>
                            api<MpTerminalDto[]>(`/v1/mercadopago/terminals/${t.id}`, {
                              method: 'PATCH',
                              body: { branchId: v === 'none' ? null : v },
                            }),
                          'Sucursal guardada.',
                        )
                      }
                    >
                      <SelectTrigger className="w-40" aria-label={`Sucursal de ${t.externalId}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">Sin sucursal</SelectItem>
                        {props.branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <label className="flex items-center gap-2 text-sm">
                      <Switch
                        checked={t.operatingMode === 'PDV'}
                        disabled={pending || t.busy}
                        onCheckedChange={(on) =>
                          run(
                            () =>
                              api<MpTerminalDto[]>(`/v1/mercadopago/terminals/${t.id}/mode`, {
                                body: { mode: on ? 'PDV' : 'STANDALONE' },
                              }),
                            on ? 'Lista para cobrar. Reiniciá la terminal.' : 'Terminal en modo autónomo.',
                          )
                        }
                      />
                      Cobra desde el sistema
                    </label>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
