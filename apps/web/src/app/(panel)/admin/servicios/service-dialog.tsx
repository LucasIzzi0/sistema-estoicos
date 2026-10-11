'use client';

import { depositProblem, type Category, type ServiceDto } from '@estoicos/shared';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MoneyInput, PercentInput } from '@/components/form/money-input';
import { Button } from '@/components/ui/button';
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

const DURATIONS = [10, 15, 20, 25, 30, 40, 45, 50, 60, 75, 90, 105, 120, 150, 180, 240];

/** Alta o edición de un servicio. Sin `service` es un alta (muestra el botón "Nuevo servicio"). */
export function ServiceDialog(props: {
  categories: Category[];
  service?: ServiceDto;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const s = props.service;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = props.open ?? internalOpen;
  const setOpen = props.onOpenChange ?? setInternalOpen;

  const [name, setName] = useState(s?.name ?? '');
  const [description, setDescription] = useState(s?.description ?? '');
  const [categoryId, setCategoryId] = useState<string>(s?.categoryId ?? 'none');
  const [durationMin, setDurationMin] = useState(s?.durationMin ?? 40);
  const [price, setPrice] = useState<number | null>(s?.basePriceCents ?? null);
  const [active, setActive] = useState(s?.active ?? true);
  const [onlineBookable, setOnlineBookable] = useState(s?.onlineBookable ?? true);
  const [depositMode, setDepositMode] = useState<ServiceDto['depositMode']>(s?.depositMode ?? 'NONE');
  const [depositFixed, setDepositFixed] = useState<number | null>(s?.depositFixedCents ?? null);
  const [depositPercent, setDepositPercent] = useState<number | null>(s?.depositPercentBps ?? null);
  const [points, setPoints] = useState<string>(s?.pointsOverride?.toString() ?? '');
  const [commission, setCommission] = useState<number | null>(s?.commissionBpsOverride ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (price === null) return setError('Indicá el precio.');
    const deposit = {
      depositMode,
      depositFixedCents: depositMode === 'FIXED' ? depositFixed : null,
      depositPercentBps: depositMode === 'PERCENT' ? depositPercent : null,
    };
    const problem = depositProblem(deposit);
    if (problem) return setError(problem);

    const body = {
      name,
      description: description || null,
      categoryId: categoryId === 'none' ? null : categoryId,
      durationMin,
      basePriceCents: price,
      active,
      onlineBookable,
      ...deposit,
      pointsOverride: points.trim() === '' ? null : Number(points),
      commissionBpsOverride: commission,
    };
    startTransition(async () => {
      try {
        await api(s ? `/v1/services/${s.id}` : '/v1/services', { method: s ? 'PATCH' : 'POST', body });
        toast.success(s ? 'Servicio actualizado.' : `"${name}" creado y ofrecido en todas las sucursales.`);
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!s && (
        <DialogTrigger asChild>
          <Button>
            <Plus />
            Nuevo servicio
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{s ? `Editar ${s.name}` : 'Nuevo servicio'}</DialogTitle>
          <DialogDescription>Un combo (ej. corte + barba) se carga como un servicio más.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="svc-name">Nombre</Label>
            <Input id="svc-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="svc-category">Categoría</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="svc-category" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin categoría</SelectItem>
                  {props.categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="svc-duration">Duración</Label>
              <Select value={String(durationMin)} onValueChange={(v) => setDurationMin(Number(v))}>
                <SelectTrigger id="svc-duration" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[...new Set([...DURATIONS, durationMin])]
                    .sort((a, b) => a - b)
                    .map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d} minutos
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="svc-price">Precio base</Label>
            <MoneyInput id="svc-price" value={price} onChange={setPrice} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="svc-desc">Descripción (opcional, se ve al reservar)</Label>
            <Input id="svc-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              Se puede reservar online
              <Switch checked={onlineBookable} onCheckedChange={setOnlineBookable} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              Activo
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          </div>

          <div className="grid gap-3 rounded-lg border p-3">
            <div className="grid gap-1.5">
              <Label htmlFor="svc-deposit">Seña al reservar online</Label>
              <Select
                value={depositMode}
                onValueChange={(v) => setDepositMode(v as ServiceDto['depositMode'])}
              >
                <SelectTrigger id="svc-deposit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="NONE">Sin seña</SelectItem>
                  <SelectItem value="FIXED">Monto fijo</SelectItem>
                  <SelectItem value="PERCENT">Porcentaje del precio</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {depositMode === 'FIXED' && <MoneyInput value={depositFixed} onChange={setDepositFixed} />}
            {depositMode === 'PERCENT' && (
              <PercentInput value={depositPercent} onChange={setDepositPercent} placeholder="30" />
            )}
            <p className="text-xs text-muted-foreground">
              El cobro de señas se activa cuando se integre Mercado Pago (Fase 5).
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="svc-points">Puntos que otorga</Label>
              <Input
                id="svc-points"
                inputMode="numeric"
                placeholder="Regla general"
                value={points}
                onChange={(e) => setPoints(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="svc-commission">Comisión específica</Label>
              <PercentInput
                id="svc-commission"
                value={commission}
                onChange={setCommission}
                placeholder="La del barbero"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : s ? 'Guardar cambios' : 'Crear servicio'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
