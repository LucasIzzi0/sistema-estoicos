import type { BarberSummary } from '@estoicos/shared';
import { HandCoins } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { BarberFormDialog } from './barber-form-dialog';

export const metadata: Metadata = { title: 'Barberos y Comisiones' };

export default async function BarbersPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  const { data: barbers } = await serverApi<BarberSummary[]>('/v1/barbers?includeInactive=true');
  const branchName = new Map(me.branches.map((b) => [b.id, b.name]));
  const list = barbers ?? [];

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageTitle
        title="Barberos y Comisiones"
        description="Quién atiende, dónde, qué servicios hace, en qué horario y con qué comisión. Los barberos no entran al sistema."
        actions={
          <div className="flex flex-wrap gap-2">
            {can(me, 'commissions:read') && (
              <Button asChild variant="outline">
                <Link href="/admin/barberos/comisiones">
                  <HandCoins /> Comisiones
                </Link>
              </Button>
            )}
            {can(me, 'barbers:manage') && <BarberFormDialog branches={me.branches} />}
          </div>
        }
      />
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Todavía no cargaste barberos.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((b) => (
            <Link key={b.id} href={`/admin/barberos/${b.id}`} className="rounded-xl focus-visible:outline-2">
              <Card
                className={`h-full transition-colors hover:border-primary/50 ${b.active ? '' : 'opacity-60'}`}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <span
                      className="size-3 shrink-0 rounded-full"
                      style={{ backgroundColor: b.color ?? '#9ca3af' }}
                    />
                    {b.displayName}
                  </CardTitle>
                </CardHeader>
                <CardContent className="grid gap-2 text-sm text-muted-foreground">
                  <span>{b.branchIds.map((id) => branchName.get(id) ?? 'Otra sucursal').join(' · ')}</span>
                  <span>{b.serviceCount} servicios</span>
                  <div className="flex flex-wrap gap-1">
                    {!b.active && <Badge variant="outline">Inactivo</Badge>}
                    {b.active && !b.hasSchedule && <Badge variant="destructive">Sin horario cargado</Badge>}
                    {!b.acceptsOnlineBooking && <Badge variant="secondary">No toma reservas online</Badge>}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
