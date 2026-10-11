'use client';

import {
  addDays,
  SETTLEMENT_STATUS_LABELS,
  type BarberCommissionSummary,
  type CommissionEntryDto,
  type SettlementDto,
  type SettlementListItem,
} from '@estoicos/shared';
import { ChevronDown, FileText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { api, ApiClientError } from '@/lib/api/client';
import { formatBps, formatCents, formatDateTime, formatDay } from '@/lib/format';

const PERIOD_LABELS: Record<string, string> = {
  WEEKLY: 'semanal',
  BIWEEKLY: 'quincenal',
  MONTHLY: 'mensual',
  CUSTOM: 'a medida',
};

export function CommissionsBoard(props: {
  today: string;
  summary: BarberCommissionSummary[];
  settlements: SettlementListItem[];
  canSettle: boolean;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [entries, setEntries] = useState<Record<string, CommissionEntryDto[]>>({});
  const [settling, setSettling] = useState<BarberCommissionSummary | null>(null);

  async function toggle(barberId: string) {
    if (open === barberId) return setOpen(null);
    setOpen(barberId);
    if (!entries[barberId]) {
      const list = await api<CommissionEntryDto[]>(
        `/v1/barbers/${barberId}/commissions/pending?until=${props.today}`,
      );
      setEntries((e) => ({ ...e, [barberId]: list }));
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Pendientes de liquidar (hasta hoy)</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {props.summary.map((b) => (
              <li key={b.barberId} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <button
                    type="button"
                    className="flex items-center gap-2 text-left"
                    onClick={() => void toggle(b.barberId)}
                  >
                    <ChevronDown
                      className={`size-4 transition-transform ${open === b.barberId ? '' : '-rotate-90'}`}
                    />
                    <span className="grid">
                      <span className="font-medium">{b.barberName}</span>
                      <span className="text-xs text-muted-foreground">
                        Liquidación {PERIOD_LABELS[b.settlementPeriod] ?? b.settlementPeriod}
                        {b.lastSettlementEnd
                          ? ` · última hasta el ${formatDay(b.lastSettlementEnd)}`
                          : ' · nunca se liquidó'}
                      </span>
                    </span>
                  </button>
                  <span className="flex items-center gap-3">
                    <span className="text-right">
                      <span className="block font-bold tabular-nums">{formatCents(b.pendingCents)}</span>
                      <span className="text-xs text-muted-foreground">{b.entriesCount} movimientos</span>
                    </span>
                    {props.canSettle && b.entriesCount > 0 && (
                      <Button size="sm" onClick={() => setSettling(b)}>
                        Liquidar
                      </Button>
                    )}
                  </span>
                </div>
                {open === b.barberId && <EntryList entries={entries[b.barberId]} />}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Liquidaciones</CardTitle>
        </CardHeader>
        <CardContent>
          {props.settlements.length === 0 ? (
            <p className="text-sm text-muted-foreground">Todavía no hay liquidaciones.</p>
          ) : (
            <ul className="divide-y text-sm">
              {props.settlements.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/barberos/comisiones/${s.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5 hover:bg-muted/50"
                  >
                    <span className="flex items-center gap-2">
                      <FileText className="size-4 text-muted-foreground" />
                      <span className="font-medium">{s.barberName}</span>
                      <span className="text-muted-foreground">
                        {formatDay(s.periodStart, { year: undefined })} al {formatDay(s.periodEnd)}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums">{formatCents(s.totalCents)}</span>
                      <Badge
                        variant={
                          s.status === 'PAID' ? 'secondary' : s.status === 'VOIDED' ? 'outline' : 'default'
                        }
                      >
                        {SETTLEMENT_STATUS_LABELS[s.status]}
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {settling && <SettleDialog barber={settling} today={props.today} onClose={() => setSettling(null)} />}
    </div>
  );
}

export function EntryList({ entries }: { entries: CommissionEntryDto[] | undefined }) {
  if (!entries) return <p className="mt-2 pl-6 text-sm text-muted-foreground">Cargando…</p>;
  return (
    <ul className="mt-2 grid gap-1 pl-6 text-sm">
      {entries.map((e) => (
        <li key={e.id} className="flex justify-between gap-3">
          <span>
            <span className="text-muted-foreground">{formatDateTime(e.occurredAt)}</span> · {e.description}
            {e.saleNumber ? <span className="text-muted-foreground"> · venta #{e.saleNumber}</span> : null}
            <span className="text-muted-foreground">
              {' '}
              · {formatBps(e.rateBps)} de {formatCents(e.baseCents)}
            </span>
          </span>
          <span className={`tabular-nums ${e.amountCents < 0 ? 'text-destructive' : ''}`}>
            {formatCents(e.amountCents)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SettleDialog(props: { barber: BarberCommissionSummary; today: string; onClose: () => void }) {
  const router = useRouter();
  const defaultStart = props.barber.lastSettlementEnd
    ? addDays(props.barber.lastSettlementEnd, 1)
    : (props.barber.oldestPending?.slice(0, 10) ?? props.today);
  const [start, setStart] = useState(defaultStart > props.today ? props.today : defaultStart);
  const [end, setEnd] = useState(props.today);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function create() {
    setError(null);
    startTransition(async () => {
      try {
        const s = await api<SettlementDto>('/v1/settlements', {
          body: { barberId: props.barber.barberId, periodStart: start, periodEnd: end },
        });
        toast.success('Liquidación creada.');
        router.push(`/admin/barberos/comisiones/${s.id}`);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo liquidar.');
      }
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && props.onClose()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Liquidar a {props.barber.barberName}</DialogTitle>
          <DialogDescription>
            Entran todas las comisiones sin liquidar hasta el fin del período (también las anteriores que
            hayan quedado).
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="st-start">Desde</Label>
            <Input id="st-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="st-end">Hasta</Label>
            <Input
              id="st-end"
              type="date"
              value={end}
              max={props.today}
              onChange={(e) => setEnd(e.target.value)}
            />
          </div>
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
          <Button disabled={pending || !start || !end || end < start} onClick={create}>
            Crear liquidación
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
