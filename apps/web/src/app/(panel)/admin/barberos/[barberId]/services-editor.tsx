'use client';

import type { BarberDetail, ServiceDto } from '@estoicos/shared';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { PercentInput } from '@/components/form/money-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ApiClientError } from '@/lib/api/client';
import { formatDuration } from '@/lib/format';

type Entry = { enabled: boolean; durationMinOverride: number | null; commissionBpsOverride: number | null };

const DURATIONS = [10, 15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90, 120, 150, 180];

/** Qué servicios hace el barbero; opcionalmente con su propia duración y comisión. */
export function ServicesEditor(props: { barber: BarberDetail; services: ServiceDto[]; canManage: boolean }) {
  const router = useRouter();
  const [entries, setEntries] = useState<Record<string, Entry>>(() =>
    Object.fromEntries(
      props.services.map((s) => {
        const current = props.barber.services.find((x) => x.serviceId === s.id);
        return [
          s.id,
          {
            enabled: Boolean(current),
            durationMinOverride: current?.durationMinOverride ?? null,
            commissionBpsOverride: current?.commissionBpsOverride ?? null,
          },
        ];
      }),
    ),
  );
  const [pending, startTransition] = useTransition();

  const set = (id: string, patch: Partial<Entry>) =>
    setEntries((e) => ({ ...e, [id]: { ...e[id]!, ...patch } }));

  function save() {
    const services = Object.entries(entries)
      .filter(([, e]) => e.enabled)
      .map(([serviceId, e]) => ({
        serviceId,
        durationMinOverride: e.durationMinOverride,
        commissionBpsOverride: e.commissionBpsOverride,
      }));
    startTransition(async () => {
      try {
        await api(`/v1/barbers/${props.barber.id}/services`, { method: 'PUT', body: { services } });
        toast.success('Servicios guardados.');
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudieron guardar los servicios.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Servicios que hace</CardTitle>
        <CardDescription>
          Si tarda distinto que lo estándar o cobra otra comisión en un servicio, indicalo acá. Vacío = lo
          general.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-1">
        {props.services.map((s) => {
          const e = entries[s.id]!;
          return (
            <div
              key={s.id}
              className="grid items-center gap-2 border-b py-2 last:border-b-0 sm:grid-cols-[1fr_11rem_9rem]"
            >
              <label className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={e.enabled}
                  disabled={!props.canManage}
                  onCheckedChange={(v) => set(s.id, { enabled: v === true })}
                />
                <span className="font-medium">{s.name}</span>
                <span className="text-muted-foreground">{formatDuration(s.durationMin)}</span>
              </label>
              {e.enabled && (
                <>
                  <Select
                    value={e.durationMinOverride ? String(e.durationMinOverride) : 'default'}
                    disabled={!props.canManage}
                    onValueChange={(v) =>
                      set(s.id, { durationMinOverride: v === 'default' ? null : Number(v) })
                    }
                  >
                    <SelectTrigger aria-label={`Duración de ${s.name} para este barbero`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Duración estándar</SelectItem>
                      {DURATIONS.map((d) => (
                        <SelectItem key={d} value={String(d)}>
                          {d} minutos
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <PercentInput
                    value={e.commissionBpsOverride}
                    onChange={(v) => set(s.id, { commissionBpsOverride: v })}
                    placeholder="Comisión general"
                  />
                </>
              )}
            </div>
          );
        })}
        {props.canManage && (
          <Button className="mt-3 w-fit" onClick={save} disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar servicios'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
