'use client';

import { POINTS_ENTRY_LABELS, type CustomerPoints } from '@estoicos/shared';
import { Gift } from 'lucide-react';
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
import { api, ApiClientError } from '@/lib/api/client';
import { formatDate, formatDateTime } from '@/lib/format';

/** Puntos del cliente en su ficha: saldo, movimientos y ajuste manual (solo dueño). */
export function CustomerPointsCard(props: {
  customerId: string;
  initial: CustomerPoints;
  canAdjust: boolean;
}) {
  const [points, setPoints] = useState(props.initial);

  return (
    <Card>
      <CardHeader className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1.5">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Gift className="size-5" /> Puntos
          </CardTitle>
          <CardDescription>
            {points.expiringSoon > 0 && points.expiringOn
              ? `Se le vencen ${points.expiringSoon} puntos el ${formatDate(points.expiringOn)}.`
              : 'Suma con cada compra y los usa cuando quiere.'}
          </CardDescription>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="font-heading text-3xl font-bold tabular-nums">{points.balance}</div>
            <div className="text-xs text-muted-foreground">disponibles</div>
          </div>
          {props.canAdjust && (
            <AdjustDialog customerId={props.customerId} onAdjusted={setPoints} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        {points.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Todavía no tiene movimientos.</p>
        ) : (
          <ul className="divide-y text-sm">
            {points.entries.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="grid">
                  <span className="font-medium">
                    {POINTS_ENTRY_LABELS[e.type]}
                    {e.saleNumber !== null && ` · venta #${e.saleNumber}`}
                  </span>
                  <span className="text-muted-foreground">
                    {formatDateTime(e.createdAt)}
                    {e.reason && ` · ${e.reason}`}
                    {e.expiresAt && e.points > 0 && ` · vencen el ${formatDate(e.expiresAt)}`}
                  </span>
                </span>
                <span
                  className={`tabular-nums font-semibold ${e.points > 0 ? 'text-success' : 'text-muted-foreground'}`}
                >
                  {e.points > 0 ? `+${e.points}` : e.points}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AdjustDialog(props: { customerId: string; onAdjusted: (p: CustomerPoints) => void }) {
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        props.onAdjusted(
          await api<CustomerPoints>(`/v1/customers/${props.customerId}/points/adjust`, {
            body: { points: Number(points), reason },
          }),
        );
        toast.success('Ajuste hecho. Queda registrado con tu nombre y el motivo.');
        setOpen(false);
        setPoints('');
        setReason('');
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo ajustar.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">Ajustar</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ajustar puntos</DialogTitle>
          <DialogDescription>
            Poné un número positivo para sumar y negativo para restar. El movimiento queda en el historial
            con tu nombre.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="adj-points">Puntos</Label>
            <Input
              id="adj-points"
              required
              inputMode="numeric"
              placeholder="20 o -20"
              className="w-32"
              value={points}
              onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ''))}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="adj-reason">Motivo</Label>
            <Input
              id="adj-reason"
              required
              placeholder="Se le cayó el sistema y no le sumamos el corte"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Guardando…' : 'Ajustar'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
