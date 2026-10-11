import type { LoyaltySettings, ProductDto, RewardDto, ServiceDto } from '@estoicos/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { LoyaltySettingsForm } from './settings-form';
import { RewardsTable } from './rewards-table';

export const metadata: Metadata = { title: 'Puntos y Recompensas' };

export default async function LoyaltyPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'loyalty:adjust')) redirect('/admin');

  const [{ data: settings }, { data: rewards }, { data: services }, { data: products }] = await Promise.all([
    serverApi<LoyaltySettings>('/v1/loyalty/settings'),
    serverApi<RewardDto[]>('/v1/rewards'),
    serverApi<ServiceDto[]>('/v1/services'),
    serverApi<ProductDto[]>('/v1/products'),
  ]);
  const usable = <T extends { id: string; name: string; active: boolean; archived: boolean }>(list: T[] | null) =>
    (list ?? []).filter((x) => x.active && !x.archived).map((x) => ({ id: x.id, name: x.name }));

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageTitle
        title="Puntos y Recompensas"
        description="Cuántos puntos suma el cliente por lo que gasta y qué puede canjear con ellos."
      />
      {settings && <LoyaltySettingsForm initial={settings} />}
      <RewardsTable
        initial={rewards ?? []}
        services={usable(services)}
        products={usable(products)}
        canManage={can(me, 'loyalty:settings')}
      />
    </div>
  );
}
