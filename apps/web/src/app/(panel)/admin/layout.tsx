import { redirect } from 'next/navigation';
import { ADMIN_NAV, visibleNav } from '@/components/panel/nav';
import { PanelShell } from '@/components/panel/panel-shell';
import { getStaffMe } from '@/lib/api/server';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar?next=/admin/dashboard');

  return (
    <PanelShell me={me} nav={visibleNav(ADMIN_NAV, me)}>
      {children}
    </PanelShell>
  );
}
