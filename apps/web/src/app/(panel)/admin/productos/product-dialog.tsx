'use client';

import type { Category, ProductDto } from '@estoicos/shared';
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

export function ProductDialog(props: {
  categories: Category[];
  product?: ProductDto;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const x = props.product;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = props.open ?? internalOpen;
  const setOpen = props.onOpenChange ?? setInternalOpen;

  const [name, setName] = useState(x?.name ?? '');
  const [categoryId, setCategoryId] = useState<string>(x?.categoryId ?? 'none');
  const [sku, setSku] = useState(x?.sku ?? '');
  const [barcode, setBarcode] = useState(x?.barcode ?? '');
  const [price, setPrice] = useState<number | null>(x?.basePriceCents ?? null);
  const [cost, setCost] = useState<number | null>(x?.costCents ?? null);
  const [trackStock, setTrackStock] = useState(x?.trackStock ?? true);
  const [active, setActive] = useState(x?.active ?? true);
  const [points, setPoints] = useState<string>(x?.pointsOverride?.toString() ?? '');
  const [commission, setCommission] = useState<number | null>(x?.commissionBpsOverride ?? null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (price === null) return setError('Indicá el precio.');
    const body = {
      name,
      description: null,
      categoryId: categoryId === 'none' ? null : categoryId,
      sku: sku || null,
      barcode: barcode || null,
      basePriceCents: price,
      costCents: cost,
      trackStock,
      active,
      pointsOverride: points.trim() === '' ? null : Number(points),
      commissionBpsOverride: commission,
    };
    startTransition(async () => {
      try {
        await api(x ? `/v1/products/${x.id}` : '/v1/products', { method: x ? 'PATCH' : 'POST', body });
        toast.success(x ? 'Producto actualizado.' : `"${name}" creado.`);
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!x && (
        <DialogTrigger asChild>
          <Button>
            <Plus />
            Nuevo producto
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{x ? `Editar ${x.name}` : 'Nuevo producto'}</DialogTitle>
          <DialogDescription>
            Ceras, shampoos, bebidas: todo lo que se vende en el mostrador.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="prd-name">Nombre</Label>
            <Input id="prd-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="prd-category">Categoría</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger id="prd-category" className="w-full">
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
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="prd-price">Precio de venta</Label>
              <MoneyInput id="prd-price" value={price} onChange={setPrice} required />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="prd-cost">Costo (opcional)</Label>
              <MoneyInput id="prd-cost" value={cost} onChange={setCost} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="prd-sku">Código interno</Label>
              <Input id="prd-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="prd-barcode">Código de barras</Label>
              <Input
                id="prd-barcode"
                inputMode="numeric"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="prd-points">Puntos que otorga</Label>
              <Input
                id="prd-points"
                inputMode="numeric"
                placeholder="Regla general"
                value={points}
                onChange={(e) => setPoints(e.target.value.replace(/\D/g, ''))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="prd-commission">Comisión específica</Label>
              <PercentInput
                id="prd-commission"
                value={commission}
                onChange={setCommission}
                placeholder="La del barbero"
              />
            </div>
          </div>
          <div className="grid gap-3 rounded-lg border p-3">
            <label className="flex items-center justify-between gap-3 text-sm">
              Controlar stock
              <Switch checked={trackStock} onCheckedChange={setTrackStock} />
            </label>
            <label className="flex items-center justify-between gap-3 text-sm">
              Activo
              <Switch checked={active} onCheckedChange={setActive} />
            </label>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : x ? 'Guardar cambios' : 'Crear producto'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
