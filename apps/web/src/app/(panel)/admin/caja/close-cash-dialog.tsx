'use client';

import { MANUAL_PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type CashSessionDto } from '@estoicos/shared';
import { Lock } from 'lucide-react';
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
import { Textarea } from '@/components/ui/textarea';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';

/**
 * Cierre con arqueo: por cada medio con movimiento (y siempre el efectivo) se anota lo contado.
 * El efectivo se cuenta en la caja; el resto se compara con el resumen del Point, del banco, etc.
 */
export function CloseCashDialog({ session }: { session: CashSessionDto }) {
  const router = useRouter();
  const methods = session.totals.filter(
    (t) =>
      (MANUAL_PAYMENT_METHODS as readonly string[]).includes(t.method) &&
      (t.method === 'CASH' || t.expectedCents !== 0),
  );
  const [open, setOpen] = useState(false);
  const [counted, setCounted] = useState<Record<string, number | null>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const ready = methods.every((m) => counted[m.method] !== undefined && counted[m.method] !== null);

  function close() {
    setError(null);
    startTransition(async () => {
      try {
        await api(`/v1/cash/${session.id}/close`, {
          body: {
            counts: methods.map((m) => ({
              method: m.method,
              countedCents: counted[m.method] ?? 0,
              note: notes[m.method]?.trim() || null,
            })),
            note: note.trim() || null,
          },
        });
        toast.success('Caja cerrada.');
        setOpen(false);
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : 'No se pudo cerrar.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Lock /> Cerrar caja
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Cierre de caja</DialogTitle>
          <DialogDescription>
            Contá el efectivo y compará cada medio con su resumen. La diferencia queda registrada con tu
            nombre.
          </DialogDescription>
        </DialogHeader>
        {session.openSalesCount > 0 && (
          <p className="rounded-md border border-warning/50 bg-warning/10 p-2 text-sm">
            Hay {session.openSalesCount} {session.openSalesCount === 1 ? 'venta abierta' : 'ventas abiertas'}{' '}
            sin cobrar. Podés cerrar igual: quedan para el día siguiente.
          </p>
        )}
        <div className="grid gap-3">
          {methods.map((m) => {
            const value = counted[m.method];
            const diff = value === undefined || value === null ? null : value - m.expectedCents;
            return (
              <div key={m.method} className="grid gap-2 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <Label htmlFor={`count-${m.method}`} className="font-semibold">
                    {PAYMENT_METHOD_LABELS[m.method]}
                  </Label>
                  <span className="text-muted-foreground">
                    Esperado{' '}
                    <span className="font-medium tabular-nums text-foreground">
                      {formatCents(m.expectedCents)}
                    </span>
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_auto_auto] items-center gap-2">
                  <MoneyInput
                    id={`count-${m.method}`}
                    value={value ?? null}
                    onChange={(v) => setCounted((c) => ({ ...c, [m.method]: v }))}
                    placeholder="Contado"
                  />
                  {/* En transferencia y Point casi siempre coincide: un toque y listo. */}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={value === m.expectedCents}
                    onClick={() => setCounted((c) => ({ ...c, [m.method]: m.expectedCents }))}
                  >
                    Coincide
                  </Button>
                  <span
                    className={cn(
                      'min-w-24 text-right text-sm font-semibold tabular-nums',
                      diff === null
                        ? 'text-muted-foreground'
                        : diff === 0
                          ? 'text-success'
                          : 'text-destructive',
                    )}
                  >
                    {diff === null
                      ? '—'
                      : diff === 0
                        ? 'Justo'
                        : `${diff > 0 ? '+' : ''}${formatCents(diff)}`}
                  </span>
                </div>
                {diff !== null && diff !== 0 && (
                  <Input
                    aria-label={`Motivo de la diferencia en ${PAYMENT_METHOD_LABELS[m.method]}`}
                    placeholder="¿Por qué la diferencia? (opcional)"
                    maxLength={200}
                    value={notes[m.method] ?? ''}
                    onChange={(e) => setNotes((n) => ({ ...n, [m.method]: e.target.value }))}
                  />
                )}
              </div>
            );
          })}
          <Textarea
            placeholder="Nota del cierre (opcional)"
            rows={2}
            maxLength={500}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Volver
          </Button>
          <Button disabled={!ready || pending} onClick={close}>
            {pending ? 'Cerrando…' : 'Cerrar caja'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
