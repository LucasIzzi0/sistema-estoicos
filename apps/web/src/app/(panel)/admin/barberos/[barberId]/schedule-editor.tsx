'use client';

import {
  minutesToTime,
  timeToMinutes,
  validateWeeklySchedule,
  WEEKDAYS,
  type BarberDetail,
  type BranchSummary,
  type ScheduleInterval,
} from '@estoicos/shared';
import { Plus, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api, ApiClientError } from '@/lib/api/client';

type Row = { start: string; end: string };

function toRows(barber: BarberDetail, branchId: string): Record<number, Row[]> {
  const rows: Record<number, Row[]> = {};
  for (const s of barber.schedules.filter((x) => x.branchId === branchId)) {
    (rows[s.weekday] ??= []).push({ start: minutesToTime(s.startMinute), end: minutesToTime(s.endMinute) });
  }
  return rows;
}

/**
 * Horario semanal por sucursal. Varios tramos por día permiten turno partido (el almuerzo
 * es el hueco entre tramos). La API rechaza tramos que se pisen, también con otras sucursales.
 */
export function ScheduleEditor(props: {
  barber: BarberDetail;
  branches: BranchSummary[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState(props.branches[0]?.id ?? '');
  const [rows, setRows] = useState(() => toRows(props.barber, branchId));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function changeBranch(id: string) {
    setBranchId(id);
    setRows(toRows(props.barber, id));
    setError(null);
  }

  const update = (weekday: number, next: Row[]) => setRows((r) => ({ ...r, [weekday]: next }));

  function save() {
    setError(null);
    const intervals: ScheduleInterval[] = [];
    for (const [weekday, list] of Object.entries(rows)) {
      for (const row of list) {
        const startMinute = timeToMinutes(row.start);
        const endMinute = timeToMinutes(row.end);
        if (startMinute === null || endMinute === null) return setError('Completá todas las horas.');
        intervals.push({ weekday: Number(weekday), startMinute, endMinute });
      }
    }
    const problem = validateWeeklySchedule(intervals);
    if (problem) return setError(problem);
    startTransition(async () => {
      try {
        await api(`/v1/barbers/${props.barber.id}/schedule`, {
          method: 'PUT',
          body: { branchId, intervals },
        });
        toast.success('Horario guardado.');
        router.refresh();
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo guardar el horario.');
      }
    });
  }

  if (props.branches.length === 0) return null;

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle className="text-lg">Horario semanal</CardTitle>
          <CardDescription>Para cortar el día (ej. almuerzo), agregá un segundo tramo.</CardDescription>
        </div>
        {props.branches.length > 1 && (
          <Select value={branchId} onValueChange={changeBranch}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {props.branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent className="grid gap-2">
        {WEEKDAYS.map((day) => {
          const list = rows[day.value] ?? [];
          const works = list.length > 0;
          return (
            <div
              key={day.value}
              className="grid gap-2 border-b py-2 last:border-b-0 sm:grid-cols-[9rem_1fr] sm:items-start"
            >
              <label className="flex items-center gap-3 pt-1.5 text-sm font-medium">
                <Switch
                  checked={works}
                  disabled={!props.canManage}
                  onCheckedChange={(on) => update(day.value, on ? [{ start: '10:00', end: '20:00' }] : [])}
                />
                {day.label}
              </label>
              {works ? (
                <div className="grid gap-2">
                  {list.map((row, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Input
                        type="time"
                        step={300}
                        className="w-32"
                        aria-label={`${day.label}, inicio del tramo ${i + 1}`}
                        disabled={!props.canManage}
                        value={row.start}
                        onChange={(e) =>
                          update(
                            day.value,
                            list.map((r, j) => (j === i ? { ...r, start: e.target.value } : r)),
                          )
                        }
                      />
                      <span className="text-muted-foreground">a</span>
                      <Input
                        type="time"
                        step={300}
                        className="w-32"
                        aria-label={`${day.label}, fin del tramo ${i + 1}`}
                        disabled={!props.canManage}
                        value={row.end}
                        onChange={(e) =>
                          update(
                            day.value,
                            list.map((r, j) => (j === i ? { ...r, end: e.target.value } : r)),
                          )
                        }
                      />
                      {props.canManage && list.length > 1 && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label="Quitar tramo"
                          onClick={() =>
                            update(
                              day.value,
                              list.filter((_, j) => j !== i),
                            )
                          }
                        >
                          <X />
                        </Button>
                      )}
                    </div>
                  ))}
                  {props.canManage && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-fit"
                      onClick={() => update(day.value, [...list, { start: '16:00', end: '20:00' }])}
                    >
                      <Plus />
                      Agregar tramo
                    </Button>
                  )}
                </div>
              ) : (
                <span className="pt-1.5 text-sm text-muted-foreground">No trabaja</span>
              )}
            </div>
          );
        })}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        {props.canManage && (
          <Button className="mt-2 w-fit" onClick={save} disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar horario'}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
