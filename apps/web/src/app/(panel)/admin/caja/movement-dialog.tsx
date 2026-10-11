'use client';

import { CASH_MOVEMENT_LABELS } from '@estoicos/shared';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
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
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiClientError } from '@/lib/api/client';

/** Aporte (cambio extra) o retiro de efectivo. No son ventas ni gastos. */
export function MovementDialog({
  sessionId,
  type,
}: {
  sessionId: string;
  type: 'CONTRIBUTION' | 'WITHDRAWAL';
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState<number | null>(null);
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = CASH_MOVEMENT_LABELS[type];

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        await api(`/v1/cash/${sessionId}/movements`, {
          body: { type, amountCents: amount ?? 0, description },
        });
        toast.success(`${label} registrado.`);
        setOpen(false);
        setAmount(null);
        setDescription('');
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          {type === 'CONTRIBUTION' ? <ArrowDownToLine /> : <ArrowUpFromLine />} {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{type === 'CONTRIBUTION' ? 'Aporte de efectivo' : 'Retiro de efectivo'}</DialogTitle>
          <DialogDescription>
            {type === 'CONTRIBUTION'
              ? 'Plata que entra a la caja y no es una venta (ej. más cambio).'
              : 'Plata que sale de la caja y no es un gasto (ej. el dueño se lleva efectivo).'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mv-amount">Monto</Label>
            <MoneyInput id="mv-amount" value={amount} onChange={setAmount} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mv-desc">Detalle</Label>
            <Input
              id="mv-desc"
              required
              minLength={3}
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || !amount}>
              Registrar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
