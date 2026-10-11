'use client';

import {
  CASH_MOVEMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  SALE_STATUS_LABELS,
  type CashSessionDto,
  type CashSessionListItem,
  type ExpenseCategoryDto,
  type SaleDetail,
  type SaleListItem,
} from '@estoicos/shared';
import { ArrowDownToLine, ArrowUpFromLine, Lock, Plus, Receipt, ShoppingBag, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MoneyInput } from '@/components/form/money-input';
import { EmptyState } from '@/components/empty-state';
import { PageTitle } from '@/components/panel/coming-soon';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiClientError } from '@/lib/api/client';
import { formatCents, formatDay, formatTime } from '@/lib/format';
import { CloseCashDialog } from './close-cash-dialog';
import { ExpenseDialog } from './expense-dialog';
import { MovementDialog } from './movement-dialog';

export function CashBoard(props: {
  branchId: string;
  branchName: string;
  session: CashSessionDto | null;
  sales: SaleListItem[];
  history: CashSessionListItem[];
  categories: ExpenseCategoryDto[];
  canClose: boolean;
  canExpenses: boolean;
}) {
  const router = useRouter();
  const { session } = props;
  const [pending, startTransition] = useTransition();

  function counterSale() {
    startTransition(async () => {
      try {
        const sale = await api<SaleDetail>(`/v1/branches/${props.branchId}/sales`, { body: {} });
        router.push(`/admin/caja/ventas/${sale.id}`);
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo crear la venta.');
      }
    });
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageTitle
        title="Caja y Ventas"
        description={`${props.branchName}. Se cobra con la caja abierta; el cierre con arqueo lo hace el dueño o el encargado.`}
        actions={
          <div className="flex flex-wrap gap-2">
            {props.canExpenses && (
              <Button asChild variant="outline">
                <Link href="/admin/caja/egresos">
                  <Receipt /> Egresos del mes
                </Link>
              </Button>
            )}
            <Button onClick={counterSale} disabled={pending}>
              <ShoppingBag /> Venta de mostrador
            </Button>
          </div>
        }
      />

      {!session ? (
        <OpenCash branchId={props.branchId} />
      ) : (
        <>
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
              <div className="grid gap-1">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Wallet className="size-5" /> Caja abierta
                  <Badge variant="secondary">{formatDay(session.businessDate)}</Badge>
                </CardTitle>
                <CardDescription>
                  La abrió {session.openedByName} a las {formatTime(session.openedAt)} con{' '}
                  {formatCents(session.openingCashCents)} en efectivo.
                </CardDescription>
              </div>
              {props.canClose && (
                <div className="flex flex-wrap gap-2">
                  <MovementDialog sessionId={session.id} type="CONTRIBUTION" />
                  <MovementDialog sessionId={session.id} type="WITHDRAWAL" />
                  {props.canExpenses && (
                    <ExpenseDialog branchId={props.branchId} categories={props.categories} fromCash />
                  )}
                  <CloseCashDialog session={session} />
                </div>
              )}
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {session.totals
                  .filter((t) => t.method === 'CASH' || t.salesCents || t.expectedCents)
                  .map((t) => (
                    <div
                      key={t.method}
                      className={`rounded-xl border p-3 ${t.method === 'CASH' ? 'border-primary/30 bg-primary/5' : 'bg-muted/30'}`}
                    >
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {PAYMENT_METHOD_LABELS[t.method]}
                      </div>
                      <div className="stat-value mt-1 text-xl">{formatCents(t.expectedCents)}</div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {t.method === 'CASH'
                          ? 'Debería haber en la caja'
                          : `Cobrado: ${formatCents(t.salesCents)}`}
                      </div>
                    </div>
                  ))}
              </div>
              <p className="text-sm text-muted-foreground">
                {session.salesCount} {session.salesCount === 1 ? 'venta cobrada' : 'ventas cobradas'} ·{' '}
                {formatCents(session.salesTotalCents)}
                {session.openSalesCount > 0 && (
                  <span className="font-medium text-warning">
                    {' '}
                    · {session.openSalesCount}{' '}
                    {session.openSalesCount === 1 ? 'venta abierta' : 'ventas abiertas'} sin cobrar
                  </span>
                )}
              </p>
              {(session.movements.length > 0 || session.expenses.length > 0) && (
                <ul className="grid gap-1 border-t pt-3 text-sm">
                  {session.movements.map((m) => (
                    <li
                      key={m.id}
                      className={`flex justify-between gap-3 ${m.voided ? 'line-through opacity-60' : ''}`}
                    >
                      <span className="flex items-center gap-2">
                        {m.type === 'CONTRIBUTION' ? (
                          <ArrowDownToLine className="size-4 text-success" />
                        ) : (
                          <ArrowUpFromLine className="size-4 text-warning" />
                        )}
                        {CASH_MOVEMENT_LABELS[m.type]}: {m.description}
                        <span className="text-xs text-muted-foreground">({m.createdByName})</span>
                      </span>
                      <span className="tabular-nums">
                        {m.type === 'WITHDRAWAL' ? '−' : '+'}
                        {formatCents(m.amountCents)}
                      </span>
                    </li>
                  ))}
                  {session.expenses.map((e) => (
                    <li
                      key={e.id}
                      className={`flex justify-between gap-3 ${e.voided ? 'line-through opacity-60' : ''}`}
                    >
                      <span className="flex items-center gap-2">
                        <Receipt className="size-4 text-muted-foreground" />
                        Egreso ({e.categoryName}): {e.description}
                      </span>
                      <span className="tabular-nums">−{formatCents(e.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Ventas de hoy</CardTitle>
          <CardDescription>Incluye las que quedaron abiertas de días anteriores.</CardDescription>
        </CardHeader>
        <CardContent>
          {props.sales.length === 0 ? (
            <EmptyState
              icon={ShoppingBag}
              title="Todavía no se cobró nada"
              description="Se cobra desde la agenda, con el botón “Cobrar” del turno, o con una venta de mostrador."
              className="py-8"
            />
          ) : (
            <ul className="divide-y">
              {props.sales.map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/admin/caja/ventas/${s.id}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm hover:bg-muted/50"
                  >
                    <span className="grid">
                      <span className="font-medium">
                        #{s.number} · {s.customerName ?? 'Sin cliente'}
                      </span>
                      <span className="text-muted-foreground">{s.summary}</span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {s.methods.map((m) => PAYMENT_METHOD_LABELS[m]).join(' + ')}
                      </span>
                      <span className="font-semibold tabular-nums">{formatCents(s.totalCents)}</span>
                      <Badge
                        variant={
                          s.status === 'OPEN'
                            ? 'default'
                            : s.status === 'VOIDED'
                              ? 'destructive'
                              : 'secondary'
                        }
                      >
                        {SALE_STATUS_LABELS[s.status]}
                      </Badge>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {props.canClose && props.history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Historial de cajas</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {props.history.map((h) => (
                <li key={h.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                  <span className="flex items-center gap-2">
                    <Lock className="size-4 text-muted-foreground" />
                    {formatDay(h.businessDate, { weekday: 'short' })}
                    <span className="text-muted-foreground">
                      {h.openedByName}
                      {h.closedByName ? ` → ${h.closedByName}` : ''}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="tabular-nums">{formatCents(h.salesTotalCents)}</span>
                    {h.differenceCents === null ? (
                      <Badge>Abierta</Badge>
                    ) : (
                      <Badge variant={h.differenceCents === 0 ? 'secondary' : 'destructive'}>
                        Diferencia {h.differenceCents > 0 ? '+' : ''}
                        {formatCents(h.differenceCents)}
                      </Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function OpenCash({ branchId }: { branchId: string }) {
  const router = useRouter();
  const [amount, setAmount] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [pending, startTransition] = useTransition();

  function open(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      try {
        await api(`/v1/branches/${branchId}/cash`, {
          body: { openingCashCents: amount ?? 0, note: note.trim() || null },
        });
        toast.success('Caja abierta.');
        router.refresh();
      } catch (err) {
        toast.error(err instanceof ApiClientError ? err.message : 'No se pudo abrir la caja.');
      }
    });
  }

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Wallet className="size-5" /> Abrir la caja del día
        </CardTitle>
        <CardDescription>
          Contá el efectivo con el que arrancás (el cambio). Sin caja abierta no se puede cobrar.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={open} className="grid max-w-md gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <div className="grid gap-1.5">
            <Label htmlFor="opening">Efectivo inicial</Label>
            <MoneyInput id="opening" value={amount} onChange={setAmount} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="opening-note">Nota (opcional)</Label>
            <Input id="opening-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </div>
          <Button type="submit" disabled={pending}>
            <Plus /> Abrir caja
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
