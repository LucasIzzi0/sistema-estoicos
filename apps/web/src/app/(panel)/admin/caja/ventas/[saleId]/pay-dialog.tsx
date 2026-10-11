'use client';

import {
  MANUAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABELS,
  type MpTerminalDto,
  type SaleDetail,
} from '@estoicos/shared';
import { Plus, Smartphone, Trash2, Wallet } from 'lucide-react';
import { useState, useTransition } from 'react';
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
import { formatCents } from '@/lib/format';
import { cn } from '@/lib/utils';
import { PointCharge } from './point-charge';

type Method = (typeof MANUAL_PAYMENT_METHODS)[number];
type Line = { method: Method; amount: number | null; reference: string };

/**
 * Cobrar en un paso, con uno o varios medios (P23). El efectivo acepta "con cuánto paga" y
 * calcula el vuelto. Todo el cobro lleva una Idempotency-Key: el doble clic no cobra dos veces.
 */
export function PayDialog({
  sale,
  terminals,
  onPaid,
}: {
  sale: SaleDetail;
  terminals: MpTerminalDto[];
  onPaid: (s: SaleDetail) => void;
}) {
  const remaining = sale.remainingCents;
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<Line[]>([{ method: 'CASH', amount: remaining, reference: '' }]);
  const [received, setReceived] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const [point, setPoint] = useState(false);
  const pointReady = terminals.some((t) => t.active && t.operatingMode === 'PDV');

  const sum = lines.reduce((a, l) => a + (l.amount ?? 0), 0);
  const cash = lines.filter((l) => l.method === 'CASH').reduce((a, l) => a + (l.amount ?? 0), 0);
  const change = received !== null && cash > 0 ? received - cash : null;

  function reset() {
    setLines([{ method: 'CASH', amount: remaining, reference: '' }]);
    setReceived(null);
    setError(null);
    setKey(crypto.randomUUID());
  }

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    const rest = Math.max(remaining - sum, 0);
    setLines((ls) => [...ls, { method: 'TRANSFER', amount: rest || null, reference: '' }]);
  }

  function pay() {
    setError(null);
    startTransition(async () => {
      try {
        const paid = await api<SaleDetail>(`/v1/sales/${sale.id}/pay`, {
          body: {
            payments: lines.map((l) => ({
              method: l.method,
              amountCents: l.amount ?? 0,
              reference: l.reference.trim() || null,
            })),
          },
          idempotencyKey: key,
        });
        setOpen(false);
        onPaid(paid);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo cobrar.');
        // Si falló, el próximo intento es un pedido nuevo.
        setKey(crypto.randomUUID());
      }
    });
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (o) reset();
        }}
      >
        <DialogTrigger asChild>
          <Button
            size="lg"
            className="w-full sm:w-auto sm:justify-self-end"
            disabled={sale.items.length === 0}
          >
            <Wallet /> Cobrar {formatCents(remaining)}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Cobrar {formatCents(remaining)}</DialogTitle>
            <DialogDescription>Podés dividir el pago en varios medios.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 rounded-lg border p-3">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Medio de pago">
                  {MANUAL_PAYMENT_METHODS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      role="radio"
                      aria-checked={l.method === m}
                      onClick={() => update(i, { method: m })}
                      className={cn(
                        'rounded-md border px-2.5 py-1 text-sm',
                        l.method === m
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'hover:border-foreground/40',
                      )}
                    >
                      {PAYMENT_METHOD_LABELS[m]}
                    </button>
                  ))}
                  {lines.length > 1 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto size-8"
                      aria-label="Quitar medio"
                      onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
                    >
                      <Trash2 />
                    </Button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <MoneyInput
                    value={l.amount}
                    onChange={(v) => update(i, { amount: v })}
                    aria-invalid={false}
                  />
                  {l.method !== 'CASH' && (
                    <Input
                      aria-label="Comprobante"
                      placeholder="Nº de operación (opcional)"
                      maxLength={80}
                      value={l.reference}
                      onChange={(e) => update(i, { reference: e.target.value })}
                    />
                  )}
                </div>
              </div>
            ))}
            {pointReady && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => {
                  setOpen(false);
                  setPoint(true);
                }}
              >
                <Smartphone /> Cobrar con el Point
              </Button>
            )}
            {lines.length < 4 && (
              <Button type="button" variant="outline" size="sm" className="w-fit" onClick={addLine}>
                <Plus /> Otro medio
              </Button>
            )}

            {cash > 0 && (
              <div className="grid gap-3 rounded-lg bg-muted/60 p-3">
                {/* Atajos: el billete justo y los que se usan todo el día. */}
                <div className="flex flex-wrap gap-1.5">
                  {billetes(cash).map((monto) => (
                    <Button
                      key={monto}
                      type="button"
                      size="sm"
                      variant={received === monto ? 'default' : 'outline'}
                      onClick={() => setReceived(monto)}
                    >
                      {monto === cash ? 'Justo' : formatCents(monto)}
                    </Button>
                  ))}
                </div>
                <div className="grid grid-cols-2 items-end gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="received" className="text-xs">
                    Paga con (efectivo)
                  </Label>
                  <MoneyInput id="received" value={received} onChange={setReceived} />
                </div>
                <p className="text-right">
                  <span className="block text-xs text-muted-foreground">Vuelto</span>
                  <span
                    className={cn(
                      'stat-value text-2xl',
                      change !== null && change < 0 && 'text-destructive',
                    )}
                  >
                    {change === null ? '—' : formatCents(Math.max(change, 0))}
                  </span>
                </p>
                </div>
              </div>
            )}

            <p className={cn('text-sm', sum === remaining ? 'text-muted-foreground' : 'text-destructive')}>
              {sum === remaining
                ? `Suma ${formatCents(sum)}: justo.`
                : sum < remaining
                  ? `Faltan ${formatCents(remaining - sum)}.`
                  : `Sobran ${formatCents(sum - remaining)}: el vuelto se calcula aparte.`}
            </p>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Volver
            </Button>
            <Button disabled={sum !== remaining || pending || (change !== null && change < 0)} onClick={pay}>
              {pending ? 'Cobrando…' : 'Confirmar cobro'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {point && (
        <PointCharge
          sale={sale}
          terminals={terminals}
          onPaid={(paid) => {
            setPoint(false);
            onPaid(paid);
          }}
          onClose={() => setPoint(false)}
        />
      )}
    </>
  );
}

/**
 * Con cuánto puede estar pagando: el importe justo y los redondeos de arriba que se arman con
 * billetes reales. Para un corte de $25.000: justo, $30.000, $40.000 y $50.000.
 */
function billetes(totalCents: number): number[] {
  const pasos = [500_000, 1_000_000, 2_000_000, 5_000_000]; // $5.000, $10.000, $20.000 y $50.000
  const opciones = new Set<number>([totalCents]);
  for (const paso of pasos) {
    const siguiente = Math.ceil(totalCents / paso) * paso;
    if (siguiente > totalCents) opciones.add(siguiente);
  }
  return [...opciones].sort((a, b) => a - b).slice(0, 4);
}
