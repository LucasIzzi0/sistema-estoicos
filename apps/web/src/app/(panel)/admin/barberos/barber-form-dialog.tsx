'use client';

import type { BarberDetail, BranchSummary } from '@estoicos/shared';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { PercentInput } from '@/components/form/money-input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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

export const BARBER_COLORS = [
  '#8a1f2d',
  '#8c6a2e',
  '#1d7348',
  '#1f4e8c',
  '#6b3fa0',
  '#0f766e',
  '#b45309',
  '#374151',
];

const PERIODS = [
  { value: 'default', label: 'El de la barbería (semanal)' },
  { value: 'WEEKLY', label: 'Semanal' },
  { value: 'BIWEEKLY', label: 'Quincenal' },
  { value: 'MONTHLY', label: 'Mensual' },
];

/** Alta (sin `barber`) o edición del perfil y las comisiones de un barbero. */
export function BarberFormDialog(props: {
  branches: BranchSummary[];
  barber?: BarberDetail;
  trigger?: React.ReactNode;
}) {
  const router = useRouter();
  const b = props.barber;
  const [open, setOpen] = useState(false);
  const [displayName, setDisplayName] = useState(b?.displayName ?? '');
  const [color, setColor] = useState(b?.color ?? BARBER_COLORS[0]!);
  const [branchIds, setBranchIds] = useState<string[]>(
    b?.branchIds ?? (props.branches.length === 1 ? [props.branches[0]!.id] : []),
  );
  const [service, setService] = useState<number | null>(b?.serviceCommissionBps ?? 5000);
  const [product, setProduct] = useState<number | null>(b?.productCommissionBps ?? 1000);
  const [tip, setTip] = useState<number | null>(b?.tipCommissionBps ?? 0);
  const [period, setPeriod] = useState<string>(b?.settlementPeriod ?? 'default');
  const [online, setOnline] = useState(b?.acceptsOnlineBooking ?? true);
  const [active, setActive] = useState(b?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const body = {
      displayName,
      color,
      branchIds,
      serviceCommissionBps: service ?? 0,
      productCommissionBps: product ?? 0,
      tipCommissionBps: tip ?? 0,
      settlementPeriod: period === 'default' ? null : period,
      acceptsOnlineBooking: online,
      ...(b ? { active } : {}),
    };
    startTransition(async () => {
      try {
        const saved = await api<BarberDetail>(b ? `/v1/barbers/${b.id}` : '/v1/barbers', {
          method: b ? 'PATCH' : 'POST',
          body,
        });
        toast.success(b ? 'Guardado.' : `${saved.displayName} creado. Ahora cargale el horario.`);
        setOpen(false);
        if (b) router.refresh();
        else router.push(`/admin/barberos/${saved.id}`);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {props.trigger ?? (
          <Button>
            <Plus />
            Nuevo barbero
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{b ? 'Perfil y comisiones' : 'Nuevo barbero'}</DialogTitle>
          <DialogDescription>
            {b
              ? 'Los cambios de comisión quedan registrados.'
              : 'Arranca haciendo todos los servicios; después se ajusta.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="barber-name">Nombre (como lo ven los clientes)</Label>
            <Input
              id="barber-name"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />
          </div>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Color en la agenda</legend>
            <div className="flex flex-wrap gap-2">
              {BARBER_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={`Color ${c}`}
                  aria-pressed={color === c}
                  onClick={() => setColor(c)}
                  className={`size-8 rounded-full ring-offset-2 ring-offset-background ${color === c ? 'ring-2 ring-foreground' : ''}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </fieldset>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">Sucursales donde trabaja</legend>
            {props.branches.map((branch) => (
              <label key={branch.id} className="flex items-center gap-3 text-sm">
                <Checkbox
                  checked={branchIds.includes(branch.id)}
                  onCheckedChange={(checked) =>
                    setBranchIds((ids) =>
                      checked === true ? [...ids, branch.id] : ids.filter((id) => id !== branch.id),
                    )
                  }
                />
                {branch.name}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 rounded-lg border p-3">
            <p className="text-sm font-medium">Comisiones</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="grid gap-1.5">
                <Label htmlFor="c-service" className="text-xs">
                  Servicios
                </Label>
                <PercentInput id="c-service" value={service} onChange={setService} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-product" className="text-xs">
                  Productos
                </Label>
                <PercentInput id="c-product" value={product} onChange={setProduct} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="c-tip" className="text-xs">
                  Propinas
                </Label>
                <PercentInput id="c-tip" value={tip} onChange={setTip} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="c-period" className="text-xs">
                Se liquida
              </Label>
              <Select value={period} onValueChange={setPeriod}>
                <SelectTrigger id="c-period" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <label className="flex items-center justify-between gap-3 text-sm">
            Toma reservas online
            <Switch checked={online} onCheckedChange={setOnline} />
          </label>
          {b && (
            <label className="flex items-center justify-between gap-3 text-sm">
              Activo (si no, no aparece en la agenda)
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : b ? 'Guardar' : 'Crear barbero'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
