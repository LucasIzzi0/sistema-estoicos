import type { BarberDetail, ServiceDto } from '@estoicos/shared';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { formatBps } from '@/lib/format';
import { BarberFormDialog } from '../barber-form-dialog';
import { ScheduleEditor } from './schedule-editor';
import { ServicesEditor } from './services-editor';
import { TimeOffs } from './time-offs';

export const metadata: Metadata = { title: 'Barbero' };

const PERIOD_LABEL: Record<string, string> = {
  WEEKLY: 'semanal',
  BIWEEKLY: 'quincenal',
  MONTHLY: 'mensual',
  CUSTOM: 'a medida',
};

export default async function BarberPage({ params }: { params: Promise<{ barberId: string }> }) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  const { barberId } = await params;
  const [{ data: barber, status }, { data: services }] = await Promise.all([
    serverApi<BarberDetail>(`/v1/barbers/${barberId}`),
    serverApi<ServiceDto[]>('/v1/services'),
  ]);
  if (!barber) {
    if (status === 404 || status === 422) notFound();
    redirect('/admin/barberos');
  }
  const canManage = can(me, 'barbers:manage');
  const branches = me.branches.filter((b) => barber.branchIds.includes(b.id));

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <Link
        href="/admin/barberos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Barberos
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="flex items-center gap-3 text-3xl font-extrabold uppercase">
          <span className="size-4 rounded-full" style={{ backgroundColor: barber.color ?? '#9ca3af' }} />
          {barber.displayName}
          {!barber.active && <Badge variant="outline">Inactivo</Badge>}
        </h1>
        {canManage && (
          <BarberFormDialog
            branches={me.branches}
            barber={barber}
            trigger={
              <Button variant="outline">
                <Pencil />
                Perfil y comisiones
              </Button>
            }
          />
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Comisiones</CardTitle>
          <CardDescription>
            Se calculan sobre lo cobrado al pagarse cada venta (Fase 4). Se liquida{' '}
            {barber.settlementPeriod
              ? PERIOD_LABEL[barber.settlementPeriod]
              : 'según la regla de la barbería (semanal)'}
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-3 gap-3">
          {[
            ['Servicios', barber.serviceCommissionBps],
            ['Productos', barber.productCommissionBps],
            ['Propinas', barber.tipCommissionBps],
          ].map(([label, value]) => (
            <div key={label as string} className="rounded-lg border p-3">
              <div className="text-xs text-muted-foreground">{label}</div>
              <div className="font-heading text-2xl font-bold tabular-nums">{formatBps(value as number)}</div>
            </div>
          ))}
        </CardContent>
      </Card>

      <ScheduleEditor barber={barber} branches={branches} canManage={canManage} />
      <ServicesEditor barber={barber} services={services ?? []} canManage={canManage} />
      <TimeOffs barber={barber} branches={branches} canManage={canManage} />
    </div>
  );
}
