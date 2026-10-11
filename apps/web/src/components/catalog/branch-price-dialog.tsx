'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MoneyInput } from '@/components/form/money-input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents } from '@/lib/format';

/** Si la sucursal ofrece el ítem y con qué precio propio (vacío = precio base). */
export function BranchPriceDialog(props: {
  kind: 'service' | 'product';
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: { id: string; name: string };
  item: {
    id: string;
    name: string;
    basePriceCents: number;
    offered: boolean;
    priceCentsOverride: number | null;
  };
}) {
  const router = useRouter();
  const [offered, setOffered] = useState(props.item.offered);
  const [price, setPrice] = useState<number | null>(props.item.priceCentsOverride);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      try {
        await api(`/v1/branches/${props.branch.id}/${props.kind}s/${props.item.id}`, {
          method: 'PUT',
          body: { offered, priceCentsOverride: price },
        });
        toast.success('Guardado.');
        props.onOpenChange(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{props.item.name}</DialogTitle>
          <DialogDescription>En {props.branch.name}</DialogDescription>
        </DialogHeader>
        <label className="flex items-center justify-between gap-3 text-sm">
          Se ofrece en esta sucursal
          <Switch checked={offered} onCheckedChange={setOffered} />
        </label>
        <div className="grid gap-1.5">
          <Label htmlFor="branch-price">Precio en esta sucursal</Label>
          <MoneyInput
            id="branch-price"
            value={price}
            onChange={setPrice}
            placeholder={formatCents(props.item.basePriceCents).replace('$', '').trim()}
          />
          <p className="text-xs text-muted-foreground">
            Vacío = usa el precio base ({formatCents(props.item.basePriceCents)}).
          </p>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={pending}>
            {pending ? 'Guardando…' : 'Guardar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
