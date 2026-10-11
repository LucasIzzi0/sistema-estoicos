import type { StaffMember } from '@estoicos/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { InviteDialog } from './invite-dialog';
import { TeamTable } from './team-table';

export const metadata: Metadata = { title: 'Usuarios del sistema' };

export default async function TeamPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'staff:read')) redirect('/admin');
  const { data: members } = await serverApi<StaffMember[]>('/v1/staff');

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageTitle
        title="Usuarios del sistema"
        description="Quién puede entrar al panel. Los barberos no tienen usuario: se gestionan en Barberos y Comisiones."
        actions={can(me, 'staff:invite') ? <InviteDialog me={me} /> : null}
      />
      <TeamTable me={me} members={members ?? []} />
    </div>
  );
}
