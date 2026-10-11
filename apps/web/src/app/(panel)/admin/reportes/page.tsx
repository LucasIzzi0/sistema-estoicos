import { PAYMENT_METHOD_LABELS, todayIn, type ReportDto } from '@estoicos/shared';
import { Banknote, Receipt, TrendingUp, Users } from 'lucide-react';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@/components/panel/nav';
import { PageHeader } from '@/components/panel/page-header';
import { StatCard } from '@/components/panel/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { formatCents, formatDate } from '@/lib/format';
import { ExportButtons } from './export-buttons';
import { RangePicker } from './range-picker';

export const metadata: Metadata = { title: 'Reportes' };

const TZ = 'America/Argentina/Buenos_Aires';
type Props = { searchParams: Promise<{ desde?: string; hasta?: string; sucursal?: string }> };
const isDate = (v: string | undefined) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);

/** Reportes por rango (Fase 8): qué se vendió, quién lo hizo, cuánto quedó y qué pasó con los puntos. */
export default async function ReportsPage({ searchParams }: Props) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'reports:view')) redirect('/admin');
  const params = await searchParams;
  const today = todayIn(TZ);
  const to = isDate(params.hasta) ? params.hasta! : today;
  const from = isDate(params.desde) ? params.desde! : `${today.slice(0, 7)}-01`;
  const branchId = me.branches.find((b) => b.id === params.sucursal)?.id;

  const { data: r } = await serverApi<ReportDto>(
    `/v1/reports?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ''}`,
  );

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageHeader
        title="Reportes"
        description={`Del ${formatDate(from)} al ${formatDate(to)}.`}
        actions={
          <RangePicker
            from={from}
            to={to}
            today={today}
            branchId={branchId ?? ''}
            branches={me.branches}
            allBranches={me.accessLevel === 'OWNER'}
          />
        }
      />

      {!r ? (
        <p className="text-muted-foreground">No se pudieron cargar los números.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="Cobrado"
              value={formatCents(r.sales.incomeCents)}
              hint={`${r.sales.count} ${r.sales.count === 1 ? 'venta' : 'ventas'}`}
              icon={Banknote}
            />
            <StatCard
              label="Ticket promedio"
              value={formatCents(r.sales.averageTicketCents)}
              hint="por venta"
              icon={Receipt}
            />
            <StatCard
              label="Clientes atendidos"
              value={String(r.customers.served)}
              hint={`${r.customers.newOnes} ${r.customers.newOnes === 1 ? 'nuevo' : 'nuevos'}`}
              icon={Users}
            />
            <StatCard
              label="Resultado"
              value={formatCents(r.result.resultCents)}
              hint={r.result.resultCents >= 0 ? 'Ganancia' : 'Pérdida'}
              tone={r.result.resultCents >= 0 ? 'good' : 'bad'}
              icon={TrendingUp}
              size="lg"
            />
          </div>

          <div className="grid items-start gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Cómo se cobró</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1.5 text-sm">
                {r.sales.byMethod.length === 0 ? (
                  <p className="text-muted-foreground">No hubo cobros en este período.</p>
                ) : (
                  r.sales.byMethod.map((m) => (
                    <Row key={m.method} label={PAYMENT_METHOD_LABELS[m.method]} value={m.amountCents} />
                  ))
                )}
                {r.sales.discountsCents > 0 && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    Se hicieron {formatCents(r.sales.discountsCents)} de descuentos sobre{' '}
                    {formatCents(r.sales.grossCents)} de precio de lista.
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">De dónde sale el resultado</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1.5 text-sm">
                <Row label="Cobrado" value={r.result.incomeCents} />
                <Row label="Comisiones" value={-r.result.commissionsCents} muted />
                <Row label="Costo de los productos" value={-r.result.productCostCents} muted />
                <Row label="Egresos" value={-r.result.expensesCents} muted />
                <div className="mt-1 border-t pt-2">
                  <Row label="Resultado" value={r.result.resultCents} />
                </div>
                {r.result.expensesByCategory.length > 0 && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    Egresos:{' '}
                    {r.result.expensesByCategory
                      .map((c) => `${c.name} ${formatCents(c.amountCents)}`)
                      .join(' · ')}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Cada barbero</CardTitle>
              <CardDescription>Las propinas quedan para la casa y no son facturación suya.</CardDescription>
            </CardHeader>
            <CardContent>
              {r.barbers.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nadie atendió en este período.</p>
              ) : (
                <div className="-mx-2 overflow-x-auto rounded-lg border sm:mx-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Barbero</TableHead>
                        <TableHead className="text-right">Servicios</TableHead>
                        <TableHead className="text-right">Facturó</TableHead>
                        <TableHead className="text-right">Comisión</TableHead>
                        <TableHead className="text-right">Propinas</TableHead>
                        <TableHead className="text-right">Faltaron</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {r.barbers.map((b) => (
                        <TableRow key={b.id}>
                          <TableCell className="font-medium">{b.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{b.services}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCents(b.revenueCents)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCents(b.commissionCents)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatCents(b.tipsCents)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {b.noShows || '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <div className="grid items-start gap-6 lg:grid-cols-2">
            <TopList title="Servicios más vendidos" items={r.services} empty="No se vendieron servicios." />
            <TopList title="Productos más vendidos" items={r.products} empty="No se vendieron productos." />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Puntos y recompensas</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-4">
              <Small label="Puntos que sumaron" value={String(r.loyalty.pointsEarned)} />
              <Small label="Puntos canjeados" value={String(r.loyalty.pointsRedeemed)} />
              <Small label="Puntos vencidos" value={String(r.loyalty.pointsExpired)} />
              <Small label="Costó en premios" value={formatCents(r.loyalty.rewardCostCents)} />
              {r.loyalty.rewards.length > 0 && (
                <p className="text-xs text-muted-foreground sm:col-span-4">
                  {r.loyalty.rewards.map((x) => `${x.name} ×${x.count}`).join(' · ')}
                </p>
              )}
            </CardContent>
          </Card>

          {can(me, 'reports:export') && <ExportButtons from={from} to={to} branchId={branchId ?? ''} />}
        </>
      )}
    </div>
  );
}

function TopList({
  title,
  items,
  empty,
}: {
  title: string;
  items: ReportDto['services'];
  empty: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y text-sm">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <span>
                  {i.name} <span className="text-muted-foreground">×{i.quantity}</span>
                </span>
                <span className="tabular-nums">{formatCents(i.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}


function Small({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="stat-value mt-1 text-xl">{value}</div>
    </div>
  );
}

function Row({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <p className={`flex justify-between ${muted ? 'text-muted-foreground' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{formatCents(value)}</span>
    </p>
  );
}
