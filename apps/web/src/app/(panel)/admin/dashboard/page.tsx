import { APPOINTMENT_STATUS_LABELS, PAYMENT_METHOD_LABELS, type DashboardDto } from '@estoicos/shared';
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CalendarCheck,
  CalendarDays,
  Receipt,
  Wallet,
} from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/empty-state';
import { can } from '@/components/panel/nav';
import { PageHeader } from '@/components/panel/page-header';
import { StatCard } from '@/components/panel/stat-card';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getStaffMe, getSystemHealth, serverApi } from '@/lib/api/server';
import { formatCents, formatTime } from '@/lib/format';
import { staffHome } from '@/lib/navigation';
import { BranchPicker } from './branch-picker';
import { SystemHealthCard } from './system-health-card';

export const metadata: Metadata = { title: 'Dashboard' };

type Props = { searchParams: Promise<{ sucursal?: string }> };

/**
 * Lo primero que se ve a la mañana, en el orden en que sirve: la plata del día, los turnos,
 * lo que hay que resolver y recién al final cómo viene el mes.
 */
export default async function DashboardPage({ searchParams }: Props) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'dashboard:view')) redirect(staffHome(me));
  const params = await searchParams;
  const branchId = me.branches.find((b) => b.id === params.sucursal)?.id;

  const [health, { data }] = await Promise.all([
    getSystemHealth(),
    serverApi<DashboardDto>(`/v1/dashboard${branchId ? `?branchId=${branchId}` : ''}`),
  ]);
  const firstName = me.user.name.split(' ')[0] ?? '';
  const dayLabel = new Date().toLocaleDateString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  if (!data) {
    return (
      <div className="mx-auto grid max-w-5xl gap-6">
        <PageHeader title={`Hola, ${firstName}`} />
        <p className="text-muted-foreground">No se pudieron cargar los números.</p>
      </div>
    );
  }

  const monthChange =
    data.month.previousCents > 0
      ? Math.round(((data.month.incomeCents - data.month.previousCents) / data.month.previousCents) * 100)
      : null;
  const pending = data.appointments.byStatus
    .filter((s) => ['BOOKED', 'CONFIRMED', 'IN_PROGRESS'].includes(s.status))
    .reduce((a, s) => a + s.count, 0);
  const noShows = data.appointments.byStatus.find((s) => s.status === 'NO_SHOW')?.count ?? 0;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageHeader
        title={`Hola, ${firstName}`}
        description={dayLabel}
        actions={
          <BranchPicker
            branchId={branchId ?? ''}
            branches={me.branches}
            allBranches={me.accessLevel === 'OWNER'}
          />
        }
      />

      {/* 1. La plata del día */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Entró hoy"
          value={formatCents(data.today.incomeCents)}
          hint={`${data.today.salesCount} ${data.today.salesCount === 1 ? 'venta' : 'ventas'}`}
          icon={Banknote}
          tone={data.today.incomeCents > 0 ? 'good' : 'default'}
          size="lg"
        />
        <StatCard
          label="Ticket promedio"
          value={formatCents(data.today.averageTicketCents)}
          hint="por venta"
          icon={Receipt}
        />
        <StatCard
          label="En caja"
          value={data.today.cashOnHandCents === null ? '—' : formatCents(data.today.cashOnHandCents)}
          hint={data.today.cashOnHandCents === null ? 'sin caja abierta' : 'efectivo esperado'}
          icon={Wallet}
        />
        <StatCard
          label="Turnos de hoy"
          value={String(data.appointments.total)}
          hint={pending > 0 ? `${pending} por atender` : 'no queda ninguno'}
          icon={CalendarDays}
        />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Cómo entró la plata hoy</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm">
            {data.today.byMethod.length === 0 ? (
              <p className="text-muted-foreground">Todavía no se cobró nada hoy.</p>
            ) : (
              data.today.byMethod.map((m) => (
                <div key={m.method} className="grid gap-1.5">
                  <div className="flex justify-between">
                    <span>{PAYMENT_METHOD_LABELS[m.method]}</span>
                    <span className="font-medium tabular-nums">{formatCents(m.amountCents)}</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{
                        width: `${Math.max(Math.round((m.amountCents / Math.max(data.today.incomeCents, 1)) * 100), 2)}%`,
                      }}
                    />
                  </div>
                </div>
              ))
            )}
            <div className="mt-2 grid gap-2 border-t pt-3">
              <p className="flex justify-between text-muted-foreground">
                <span>Esta semana</span>
                <span className="tabular-nums">{formatCents(data.week.incomeCents)}</span>
              </p>
              <p className="flex items-center justify-between text-muted-foreground">
                <span>Este mes</span>
                <span className="flex items-center gap-2">
                  <span className="tabular-nums">{formatCents(data.month.incomeCents)}</span>
                  {monthChange !== null && (
                    <Badge
                      variant="outline"
                      className={
                        monthChange >= 0
                          ? 'border-success/40 bg-success/10 text-success'
                          : 'border-destructive/40 bg-destructive/10 text-destructive'
                      }
                    >
                      {monthChange > 0 ? '+' : ''}
                      {monthChange} %
                    </Badge>
                  )}
                </span>
              </p>
              {monthChange !== null && (
                <p className="text-xs text-muted-foreground">
                  Comparado con los mismos días del mes pasado ({formatCents(data.month.previousCents)}).
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* 2. Los turnos del día */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Lo que viene hoy</CardTitle>
            <CardDescription>
              {noShows > 0 ? `${noShows} no vinieron.` : 'Nadie faltó todavía.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {data.appointments.next.length === 0 ? (
              <EmptyState
                icon={CalendarCheck}
                title="No queda nadie por atender"
                description="Cuando entre un turno para hoy, aparece acá con su hora y su barbero."
                className="py-8"
              />
            ) : (
              <ul className="divide-y text-sm">
                {data.appointments.next.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                    <span className="grid">
                      <span className="font-medium">
                        {formatTime(a.startsAt)} · {a.customerName}
                      </span>
                      <span className="text-muted-foreground">
                        {a.services.join(' + ')} · {a.barberName}
                      </span>
                    </span>
                    <Badge variant="outline">{APPOINTMENT_STATUS_LABELS[a.status]}</Badge>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/admin/agenda"
              className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              Ver la agenda completa
              <ArrowRight className="size-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* 3. Lo que hay que resolver */}
      <Issues alerts={data.alerts} branchId={branchId} />
      <SystemHealthCard health={health} />

      {/* 4. Ocupación y clientes */}
      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Ocupación de hoy</CardTitle>
            <CardDescription>Cuánto de su jornada tiene reservado cada uno.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {data.barbers.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay barberos activos.</p>
            ) : (
              data.barbers.map((b) => (
                <div key={b.barberId} className="grid gap-1">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{b.name}</span>
                    <span className="text-muted-foreground">
                      {b.availableMinutes === 0
                        ? 'no trabaja hoy'
                        : `${Math.round(b.occupancyBps / 100)} % · ${b.appointments} turnos`}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${
                        b.occupancyBps >= 8000
                          ? 'bg-success'
                          : b.occupancyBps >= 4000
                            ? 'bg-primary'
                            : 'bg-primary/40'
                      }`}
                      style={{ width: `${Math.min(b.occupancyBps / 100, 100)}%` }}
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Clientes del mes</CardTitle>
            <CardDescription>Nuevos vs. los que vuelven.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">
                Vinieron por primera vez
              </div>
              <div className="stat-value mt-1 text-3xl">{data.customers.newOnes}</div>
            </div>
            <div className="rounded-xl border bg-muted/30 p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Volvieron</div>
              <div className="stat-value mt-1 text-3xl">{data.customers.returning}</div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Issues({ alerts, branchId }: { alerts: DashboardDto['alerts']; branchId?: string }) {
  const items: { text: string; href: string }[] = [];
  if (alerts.staleOpenSales > 0)
    items.push({
      text: `${alerts.staleOpenSales} ${alerts.staleOpenSales === 1 ? 'venta quedó abierta' : 'ventas quedaron abiertas'} de días anteriores`,
      href: '/admin/caja/ventas',
    });
  if (alerts.openCashSessions > 0)
    items.push({
      text: `${alerts.openCashSessions} ${alerts.openCashSessions === 1 ? 'caja quedó sin cerrar' : 'cajas quedaron sin cerrar'}`,
      href: '/admin/caja',
    });
  if (alerts.unmatchedPayments > 0)
    items.push({
      text: `${alerts.unmatchedPayments} cobros de Mercado Pago sin asignar a una venta`,
      href: '/admin/pagos-mp',
    });
  if (alerts.lowStock.length > 0)
    items.push({
      text: `Se está acabando: ${alerts.lowStock.map((p) => `${p.name} (${p.stockOnHand})`).join(', ')}`,
      href: `/admin/productos/stock${branchId ? `?sucursal=${branchId}` : ''}`,
    });
  if (alerts.failedNotifications > 0)
    items.push({
      text: `${alerts.failedNotifications} mensajes fallaron esta semana`,
      href: '/admin/notificaciones',
    });

  if (items.length === 0) return null;
  return (
    <Card className="border-warning/50">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <AlertTriangle className="size-5 text-warning" /> Para resolver
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-1.5 text-sm">
          {items.map((i) => (
            <li key={i.href}>
              <Link
                href={i.href}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-warning/10"
              >
                <span>{i.text}</span>
                <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

