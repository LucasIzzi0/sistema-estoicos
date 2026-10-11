'use client';

import { MP_STAGE_LABELS, type MpOrderDto, type MpTerminalDto, type SaleDetail } from '@estoicos/shared';
import { CheckCircle2, Loader2, Smartphone, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents } from '@/lib/format';

/** El sistema recuerda la última terminal usada (lo habitual es usar siempre la misma). */
const LAST_TERMINAL_KEY = 'estoicos:last-terminal';

/**
 * Cobro con el Point: se manda el monto a la terminal y se ve el estado en vivo. El cobro lo
 * confirma Mercado Pago (no el sistema), así que la pantalla pregunta cada 2 segundos.
 */
export function PointCharge(props: {
  sale: SaleDetail;
  terminals: MpTerminalDto[];
  onPaid: (sale: SaleDetail) => void;
  onClose: () => void;
}) {
  const usable = props.terminals.filter((t) => t.active && t.operatingMode === 'PDV' && !t.busy);
  const [terminalId, setTerminalId] = useState(() => {
    const last = typeof window === 'undefined' ? null : window.localStorage.getItem(LAST_TERMINAL_KEY);
    return usable.find((t) => t.id === last)?.id ?? usable[0]?.id ?? '';
  });
  const [amount, setAmount] = useState<number | null>(props.sale.remainingCents);
  const [order, setOrder] = useState<MpOrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(() => crypto.randomUUID());
  const [pending, startTransition] = useTransition();
  const finished = useRef(false);

  const send = () => {
    setError(null);
    startTransition(async () => {
      try {
        const created = await api<MpOrderDto>(`/v1/sales/${props.sale.id}/point-orders`, {
          body: { terminalId, amountCents: amount ?? 0 },
          idempotencyKey: key,
        });
        window.localStorage.setItem(LAST_TERMINAL_KEY, terminalId);
        setOrder(created);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo mandar el cobro.');
      }
    });
  };

  // Estado en vivo: se pregunta cada 2 segundos hasta que Mercado Pago resuelve.
  const poll = useCallback(async () => {
    if (!order || order.status !== 'PENDING' || finished.current) return;
    try {
      const fresh = await api<MpOrderDto>(`/v1/point-orders/${order.id}`);
      setOrder(fresh);
      if (fresh.status === 'APPROVED') {
        finished.current = true;
        const sale = await api<SaleDetail>(`/v1/sales/${props.sale.id}`);
        toast.success('Cobro aprobado.');
        props.onPaid(sale);
      }
    } catch {
      // Un error de red puntual no rompe la pantalla: se reintenta en el próximo ciclo.
    }
  }, [order, props]);

  useEffect(() => {
    if (!order || order.status !== 'PENDING') return;
    const timer = setInterval(() => void poll(), 2000);
    return () => clearInterval(timer);
  }, [order, poll]);

  function cancel() {
    if (!order) return;
    startTransition(async () => {
      try {
        setOrder(await api<MpOrderDto>(`/v1/point-orders/${order.id}/cancel`, { body: {} }));
        toast.success('Cobro cancelado.');
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo cancelar.');
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !pending && props.onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="size-5" /> Cobrar con el Point
          </DialogTitle>
          <DialogDescription>
            {order
              ? 'El cobro está en la terminal. No cierres esta pantalla hasta que termine.'
              : 'Se manda el monto a la terminal y el cliente paga ahí.'}
          </DialogDescription>
        </DialogHeader>

        {!order ? (
          <div className="grid gap-3">
            {usable.length === 0 ? (
              <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
                No hay ninguna terminal libre y lista para cobrar. Revisalas en “Pagos Mercado Pago”.
              </p>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="pt-terminal">Terminal</Label>
                  <Select value={terminalId} onValueChange={setTerminalId}>
                    <SelectTrigger id="pt-terminal" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {usable.map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.label ?? t.externalId}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pt-amount">Monto</Label>
                  <MoneyInput id="pt-amount" value={amount} onChange={setAmount} />
                  <p className="text-xs text-muted-foreground">
                    Falta cobrar {formatCents(props.sale.remainingCents)}. Podés mandar menos y completar con
                    otro medio.
                  </p>
                </div>
              </>
            )}
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
          </div>
        ) : (
          <Status order={order} />
        )}

        <DialogFooter>
          {!order ? (
            <>
              <Button variant="outline" onClick={props.onClose}>
                Volver
              </Button>
              <Button disabled={!terminalId || !amount || pending} onClick={send}>
                {pending ? 'Mandando…' : 'Mandar al Point'}
              </Button>
            </>
          ) : order.status === 'PENDING' ? (
            <Button variant="outline" disabled={!order.cancelable || pending} onClick={cancel}>
              {order.cancelable ? 'Cancelar el cobro' : 'Cancelalo desde la terminal'}
            </Button>
          ) : (
            <Button onClick={props.onClose}>Cerrar</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Status({ order }: { order: MpOrderDto }) {
  const stage = MP_STAGE_LABELS[order.mpStatus ?? ''] ?? 'Esperando a Mercado Pago';
  const failed = ['REJECTED', 'CANCELED', 'EXPIRED'].includes(order.status);
  return (
    <div className="grid justify-items-center gap-3 py-6 text-center">
      {order.status === 'PENDING' ? (
        <Loader2 className="size-10 animate-spin text-muted-foreground" />
      ) : order.status === 'APPROVED' ? (
        <CheckCircle2 className="size-10 text-success" />
      ) : (
        <XCircle className="size-10 text-destructive" />
      )}
      <p className="text-lg font-semibold">{stage}</p>
      <p className="tabular-nums text-muted-foreground">
        {formatCents(order.paidAmountCents ?? order.amountCents)}
      </p>
      {failed && order.mpStatusDetail && (
        <p className="text-sm text-destructive">Motivo: {order.mpStatusDetail}. Podés reintentar el cobro.</p>
      )}
    </div>
  );
}
