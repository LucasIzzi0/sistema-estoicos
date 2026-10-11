'use client';

import { applyPercentChange, PRICE_ROUNDINGS, type BulkPriceResult } from '@estoicos/shared';
import { TrendingUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
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
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents } from '@/lib/format';

export interface PricedItem {
  id: string;
  name: string;
  basePriceCents: number;
}

/** Aumento (o baja) masivo por porcentaje, con redondeo y vista previa antes de confirmar. */
export function BulkPriceDialog(props: { kind: 'service' | 'product'; items: PricedItem[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [percentBps, setPercentBps] = useState<number | null>(1000);
  const [roundTo, setRoundTo] = useState<number>(10_000);
  const [includeBranchPrices, setIncludeBranchPrices] = useState(true);
  const [pending, startTransition] = useTransition();

  const preview = useMemo(
    () =>
      props.items.map((i) => ({
        ...i,
        after: percentBps ? applyPercentChange(i.basePriceCents, percentBps, roundTo) : i.basePriceCents,
      })),
    [props.items, percentBps, roundTo],
  );

  function confirm() {
    if (!percentBps) return;
    startTransition(async () => {
      try {
        const result = await api<BulkPriceResult>(`/v1/${props.kind}s/bulk-price`, {
          body: { percentBps, roundToCents: roundTo, includeBranchPrices },
        });
        toast.success(`Actualizamos ${result.updated} precios.`);
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudieron actualizar los precios.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <TrendingUp />
          Aumento masivo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Actualizar precios por porcentaje</DialogTitle>
          <DialogDescription>
            Se aplica a todos los {props.kind === 'service' ? 'servicios' : 'productos'} activos. Cada cambio
            queda registrado.
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-percent">Porcentaje</Label>
            <PercentInput
              id="bulk-percent"
              value={percentBps}
              onChange={setPercentBps}
              allowNegative
              placeholder="10"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bulk-round">Redondear a</Label>
            <Select value={String(roundTo)} onValueChange={(v) => setRoundTo(Number(v))}>
              <SelectTrigger id="bulk-round" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRICE_ROUNDINGS.map((r) => (
                  <SelectItem key={r} value={String(r)}>
                    {formatCents(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <label className="flex items-center gap-3 text-sm">
          <Checkbox
            checked={includeBranchPrices}
            onCheckedChange={(v) => setIncludeBranchPrices(v === true)}
          />
          Aplicar también a los precios propios de cada sucursal
        </label>
        <div className="max-h-64 overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">
                  {props.kind === 'service' ? 'Servicio' : 'Producto'}
                </th>
                <th className="px-3 py-2 text-right font-medium">Hoy</th>
                <th className="px-3 py-2 text-right font-medium">Nuevo</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-3 py-2">{row.name}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatCents(row.basePriceCents)}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums">{formatCents(row.after)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <DialogFooter>
          <Button onClick={confirm} disabled={pending || !percentBps || props.items.length === 0}>
            {pending ? 'Actualizando…' : `Actualizar ${props.items.length} precios`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
