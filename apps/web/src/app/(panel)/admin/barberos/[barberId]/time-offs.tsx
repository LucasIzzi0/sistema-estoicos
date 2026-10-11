'use client';

import { TIME_OFF_LABELS, TIME_OFF_TYPES, type BarberDetail, type BranchSummary } from '@estoicos/shared';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { api, ApiClientError } from '@/lib/api/client';
import { formatRange } from '@/lib/format';

type TimeOffType = (typeof TIME_OFF_TYPES)[number];

/** Bloqueos puntuales del barbero: vacaciones, trámites, enfermedad. */
export function TimeOffs(props: { barber: BarberDetail; branches: BranchSummary[]; canManage: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const branchName = new Map(props.branches.map((b) => [b.id, b.name]));

  function remove(id: string) {
    startTransition(async () => {
      try {
        await api(`/v1/barbers/${props.barber.id}/time-offs/${id}`, { method: 'DELETE' });
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo borrar.');
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle className="text-lg">Bloqueos</CardTitle>
          <CardDescription>
            Días u horarios en los que no atiende. No se le pueden dar turnos ahí.
          </CardDescription>
        </div>
        {props.canManage && <NewTimeOff barberId={props.barber.id} branches={props.branches} />}
      </CardHeader>
      <CardContent>
        {props.barber.timeOffs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tiene bloqueos próximos.</p>
        ) : (
          <ul className="grid gap-2">
            {props.barber.timeOffs.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                <span className="font-medium">{TIME_OFF_LABELS[t.type]}</span>
                <span className="text-muted-foreground">{formatRange(t.startsAt, t.endsAt)}</span>
                <span className="text-muted-foreground">
                  {t.branchId ? branchName.get(t.branchId) : 'Todas las sucursales'}
                </span>
                {t.note && <span className="text-muted-foreground">· {t.note}</span>}
                {props.canManage && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-auto"
                    disabled={pending}
                    aria-label="Borrar bloqueo"
                    onClick={() => remove(t.id)}
                  >
                    <Trash2 />
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

function NewTimeOff(props: { barberId: string; branches: BranchSummary[] }) {
  const router = useRouter();
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' });
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<TimeOffType>('VACATION');
  const [branchId, setBranchId] = useState<string>('all');
  const [allDay, setAllDay] = useState(true);
  const [date, setDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [startTime, setStartTime] = useState('13:00');
  const [endTime, setEndTime] = useState('14:00');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await api(`/v1/barbers/${props.barberId}/time-offs`, {
          body: {
            type,
            branchId: branchId === 'all' ? null : branchId,
            date,
            ...(allDay ? { endDate } : { startTime, endTime }),
            note: note || null,
          },
        });
        toast.success('Bloqueo agregado.');
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo agregar.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Plus />
          Agregar bloqueo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nuevo bloqueo</DialogTitle>
          <DialogDescription>En hora de la sucursal.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="to-type">Motivo</Label>
              <Select value={type} onValueChange={(v) => setType(v as TimeOffType)}>
                <SelectTrigger id="to-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIME_OFF_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TIME_OFF_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="to-branch">Sucursal</Label>
              <Select value={branchId} onValueChange={setBranchId}>
                <SelectTrigger id="to-branch" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas</SelectItem>
                  {props.branches.map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Días completos
            <Switch checked={allDay} onCheckedChange={setAllDay} />
          </label>
          {allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="to-from">Desde</Label>
                <Input
                  id="to-from"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="to-until">Hasta (inclusive)</Label>
                <Input
                  id="to-until"
                  type="date"
                  required
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="to-day">Día</Label>
                <Input
                  id="to-day"
                  type="date"
                  required
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Input
                  type="time"
                  step={300}
                  aria-label="Desde"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                />
                <Input
                  type="time"
                  step={300}
                  aria-label="Hasta"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                />
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="to-note">Nota (opcional)</Label>
            <Input id="to-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Agregar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
