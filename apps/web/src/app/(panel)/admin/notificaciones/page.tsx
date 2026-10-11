import type { NotificationLogItem, NotificationSettings } from '@estoicos/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { NotificationLog } from './notification-log';
import { NotificationSettingsForm } from './settings-form';

export const metadata: Metadata = { title: 'Notificaciones' };

export default async function NotificationsPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'notifications:settings')) redirect('/admin');
  const [{ data: settings }, { data: log }] = await Promise.all([
    serverApi<NotificationSettings>('/v1/notifications/settings'),
    serverApi<NotificationLogItem[]>('/v1/notifications?limit=50'),
  ]);

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageTitle
        title="Notificaciones"
        description="Qué mensajes se mandan, por dónde salen y qué pasó con cada uno."
      />
      {settings && <NotificationSettingsForm initial={settings} />}
      <NotificationLog initial={log ?? []} />
    </div>
  );
}
