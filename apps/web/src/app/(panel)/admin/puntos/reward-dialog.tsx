'use client';

import { REWARD_TYPE_LABELS, REWARD_TYPES, type RewardDto, type RewardType } from '@estoicos/shared';
import { Plus } from 'lucide-react';
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

export type CatalogOption = { id: string; name: string };

/** Alta o edición de una recompensa. Sin `reward` es un alta. */
export function RewardDialog(props: {
  reward?: RewardDto;
  services: CatalogOption[];
  products: CatalogOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (rewards: RewardDto[]) => void;
}) {
  const r = props.reward;
  const [name, setName] = useState(r?.name ?? '');
  const [description, setDescription] = useState(r?.description ?? '');
  const [type, setType] = useState<RewardType>(r?.type ?? 'FREE_SERVICE');
  const [pointsCost, setPointsCost] = useState(r?.pointsCost?.toString() ?? '');
  const [serviceId, setServiceId] = useState(r?.serviceId ?? '');
  const [productId, setProductId] = useState(r?.productId ?? '');
  const [fixed, setFixed] = useState<number | null>(r?.discountFixedCents ?? null);
  const [percent, setPercent] = useState<number | null>(r?.discountPercentBps ?? null);
  const [active, setActive] = useState(r?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    const body = {
      name,
      description: description || null,
      type,
      pointsCost: Number(pointsCost),
      serviceId: type === 'FREE_SERVICE' ? serviceId || null : null,
      productId: type === 'FREE_PRODUCT' ? productId || null : null,
      discountFixedCents: type === 'FIXED_DISCOUNT' ? fixed : null,
      discountPercentBps: type === 'PERCENT_DISCOUNT' ? percent : null,
      active,
    };
    startTransition(async () => {
      try {
        props.onSaved(
          await api<RewardDto[]>(r ? `/v1/rewards/${r.id}` : '/v1/rewards', {
            method: r ? 'PATCH' : 'POST',
            body,
          }),
        );
        toast.success(r ? 'Recompensa actualizada.' : `"${name}" agregada al catálogo.`);
        props.onOpenChange(false);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      {!r && (
        <DialogTrigger asChild>
          <Button>
            <Plus />
            Nueva recompensa
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{r ? `Editar ${r.name}` : 'Nueva recompensa'}</DialogTitle>
          <DialogDescription>
            El nombre es lo que ve el cliente en su cuenta y en el mostrador.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="rw-name">Nombre</Label>
            <Input
              id="rw-name"
              required
              placeholder="Corte gratis"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="rw-type">Qué recibe</Label>
              <Select value={type} onValueChange={(v) => setType(v as RewardType)}>
                <SelectTrigger id="rw-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REWARD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {REWARD_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rw-cost">Cuántos puntos cuesta</Label>
              <Input
                id="rw-cost"
                required
                inputMode="numeric"
                placeholder="120"
                value={pointsCost}
                onChange={(e) => setPointsCost(e.target.value.replace(/\D/g, ''))}
              />
            </div>
          </div>

          {type === 'FREE_SERVICE' && (
            <div className="grid gap-1.5">
              <Label htmlFor="rw-service">Servicio que se regala</Label>
              <Select value={serviceId} onValueChange={setServiceId}>
                <SelectTrigger id="rw-service" className="w-full">
                  <SelectValue placeholder="Elegí el servicio" />
                </SelectTrigger>
                <SelectContent>
                  {props.services.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {type === 'FREE_PRODUCT' && (
            <div className="grid gap-1.5">
              <Label htmlFor="rw-product">Producto que se regala</Label>
              <Select value={productId} onValueChange={setProductId}>
                <SelectTrigger id="rw-product" className="w-full">
                  <SelectValue placeholder="Elegí el producto" />
                </SelectTrigger>
                <SelectContent>
                  {props.products.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {type === 'FIXED_DISCOUNT' && (
            <div className="grid gap-1.5">
              <Label htmlFor="rw-fixed">Monto del descuento</Label>
              <MoneyInput id="rw-fixed" value={fixed} onChange={setFixed} required />
            </div>
          )}
          {type === 'PERCENT_DISCOUNT' && (
            <div className="grid gap-1.5">
              <Label htmlFor="rw-percent">Porcentaje del descuento</Label>
              <PercentInput id="rw-percent" value={percent} onChange={setPercent} placeholder="20" />
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="rw-desc">Descripción (opcional, la ve el cliente)</Label>
            <Input id="rw-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
            Se puede canjear
            <Switch checked={active} onCheckedChange={setActive} />
          </label>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : r ? 'Guardar cambios' : 'Crear recompensa'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
