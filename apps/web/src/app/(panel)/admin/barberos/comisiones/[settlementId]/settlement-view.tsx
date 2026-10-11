'use client';

import {
  EXPENSE_METHOD_LABELS,
  PAYMENT_METHOD_LABELS,
  SETTLEMENT_METHODS,
  SETTLEMENT_STATUS_LABELS,
  type SettlementDto,
} from '@estoicos/shared';
import { Ban, Printer, Wallet } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents, formatDateTime, formatDay } from '@/lib/format';
import { EntryList } from '../commissions-board';

export function SettlementView(props: {
  settlement: SettlementDto;
  canSettle: boolean;
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [s, setS] = useState(props.settlement);
  const [paying, setPaying] = useState(false);
  const [voiding, setVoiding] = useState(false);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h1 className="flex items-center gap-3 text-3xl font-extrabold uppercase">
            {s.barberName}
            <Badge
              variant={s.status === 'PAID' ? 'secondary' : s.status === 'VOIDED' ? 'outline' : 'default'}
            >
              {SETTLEMENT_STATUS_LABELS[s.status]}
            </Badge>
          </h1>
          <p className="text-sm text-muted-foreground">
            Del {formatDay(s.periodStart)} al {formatDay(s.periodEnd)} · creada por {s.createdByName}
            {s.paidAt && ` · pagada ${formatDateTime(s.paidAt)} (${PAYMENT_METHOD_LABELS[s.paymentMethod!]})`}
            {s.voidReason && ` · anulada: ${s.voidReason}`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.status !== 'VOIDED' && (
            <Button asChild variant="outline">
              <a href={`/imprimir/liquidacion/${s.id}`} target="_blank" rel="noreferrer">
                <Printer /> Resumen para el barbero
              </a>
            </Button>
          )}
          {props.canSettle && s.status === 'DRAFT' && (
            <Button onClick={() => setPaying(true)}>
              <Wallet /> Marcar pagada
            </Button>
          )}
          {props.canSettle && s.status !== 'VOIDED' && (
            <Button variant="outline" className="text-destructive" onClick={() => setVoiding(true)}>
              <Ban /> Anular
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Servicios', s.byType.services],
          ['Productos', s.byType.products],
          ['Propinas', s.byType.tips],
          ['Total', s.totalCents],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border p-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="font-heading text-xl font-bold tabular-nums">{formatCents(value as number)}</div>
          </div>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Detalle ({s.entries.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <EntryList entries={s.entries} />
        </CardContent>
      </Card>

      {paying && (
        <PayDialog
          settlement={s}
          branches={props.branches}
          onClose={() => setPaying(false)}
          onDone={(updated) => {
            setS(updated);
            setPaying(false);
            toast.success('Liquidación pagada: quedó registrada como egreso.');
            router.refresh();
          }}
        />
      )}
      {voiding && (
        <VoidDialog
          settlement={s}
          onClose={() => setVoiding(false)}
          onDone={(updated) => {
            setS(updated);
            setVoiding(false);
            toast.success('Liquidación anulada: las comisiones vuelven a estar pendientes.');
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function PayDialog(props: {
  settlement: SettlementDto;
  branches: { id: string; name: string }[];
  onClose: () => void;
  onDone: (s: SettlementDto) => void;
}) {
  const [method, setMethod] = useState<(typeof SETTLEMENT_METHODS)[number]>('CASH');
  const [fromCash, setFromCash] = useState(true);
  const [branchId, setBranchId] = useState(props.branches[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function pay() {
    setError(null);
    startTransition(async () => {
      try {
        props.onDone(
          await api<SettlementDto>(`/v1/settlements/${props.settlement.id}/pay`, {
            body: { method, fromCashSessionBranchId: method === 'CASH' && fromCash ? branchId : null },
          }),
        );
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo registrar el pago.');
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Pagar {formatCents(props.settlement.totalCents)}</DialogTitle>
          <DialogDescription>Se registra como egreso en “Comisiones”.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="pay-method">Medio</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
              <SelectTrigger id="pay-method" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SETTLEMENT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {EXPENSE_METHOD_LABELS[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {method === 'CASH' && (
            <>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox checked={fromCash} onCheckedChange={(v) => setFromCash(v === true)} />
                Sale de la caja abierta (descuenta del efectivo esperado)
              </label>
              {fromCash && props.branches.length > 1 && (
                <Select value={branchId} onValueChange={setBranchId}>
                  <SelectTrigger className="w-full" aria-label="Caja de la sucursal">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {props.branches.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        Caja de {b.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}
        </div>
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Volver
          </Button>
          <Button disabled={pending} onClick={pay}>
            Confirmar pago
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidDialog(props: {
  settlement: SettlementDto;
  onClose: () => void;
  onDone: (s: SettlementDto) => void;
}) {
  const [reason, setReason] = useState('');
  const [pending, startTransition] = useTransition();
  function confirm() {
    startTransition(async () => {
      try {
        props.onDone(
          await api<SettlementDto>(`/v1/settlements/${props.settlement.id}/void`, { body: { reason } }),
        );
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo anular.');
      }
    });
  }
  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>¿Anular la liquidación?</DialogTitle>
          <DialogDescription>
            Sus comisiones vuelven a quedar pendientes
            {props.settlement.status === 'PAID' ? ' y se anula el egreso del pago' : ''}.
          </DialogDescription>
        </DialogHeader>
        <Input
          aria-label="Motivo"
          placeholder="Motivo (obligatorio)"
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <DialogFooter>
          <Button variant="outline" onClick={props.onClose}>
            Volver
          </Button>
          <Button variant="destructive" disabled={reason.trim().length < 3 || pending} onClick={confirm}>
            Anular
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
