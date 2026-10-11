import type { BranchDetail } from '@estoicos/shared';
import { ChevronRight, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { BranchesManager } from './branches-manager';

export const metadata: Metadata = { title: 'Configuración' };

export default async function SettingsPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'staff:read')) redirect('/admin');
  const { data: branches } = await serverApi<BranchDetail[]>('/v1/branches');

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageTitle title="Configuración" description="Sucursales, feriados y usuarios del sistema." />
      <Link href="/admin/configuracion/equipo" className="rounded-xl focus-visible:outline-2">
        <Card className="transition-colors hover:border-primary/50">
          <CardHeader className="flex flex-row items-center gap-3">
            <Users className="size-5 text-muted-foreground" />
            <div className="grid flex-1 gap-1">
              <CardTitle className="text-lg">Usuarios del sistema</CardTitle>
              <CardDescription>
                Dueños y encargados que entran al panel. Invitar, reenviar, desactivar.
              </CardDescription>
            </div>
            <ChevronRight className="size-5 text-muted-foreground" />
          </CardHeader>
        </Card>
      </Link>
      <BranchesManager
        branches={branches ?? []}
        canManage={can(me, 'branches:manage')}
        canClosures={can(me, 'closures:manage')}
      />
    </div>
  );
}
