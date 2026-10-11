import type { Category, ServiceDto } from '@estoicos/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { BulkPriceDialog } from '@/components/catalog/bulk-price-dialog';
import { CategoryDialog } from '@/components/catalog/category-dialog';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { currentBranch } from '@/lib/branch';
import { ServiceDialog } from './service-dialog';
import { ServicesTable } from './services-table';

export const metadata: Metadata = { title: 'Servicios' };

export default async function ServicesPage({
  searchParams,
}: {
  searchParams: Promise<{ archivados?: string }>;
}) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  const showArchived = (await searchParams).archivados === '1';
  const [{ data: services }, { data: categories }, branch] = await Promise.all([
    serverApi<ServiceDto[]>(`/v1/services${showArchived ? '?includeArchived=true' : ''}`),
    serverApi<Category[]>('/v1/service-categories'),
    currentBranch(me),
  ]);
  const canManage = can(me, 'catalog:manage');
  const list = services ?? [];

  return (
    <div className="mx-auto grid max-w-6xl gap-6">
      <PageTitle
        title="Servicios"
        description="Cortes, barba y combos. El precio base vale en todas las sucursales, salvo que una tenga el suyo."
        actions={
          canManage ? (
            <div className="flex flex-wrap gap-2">
              <CategoryDialog kind="service" categories={categories ?? []} />
              <BulkPriceDialog kind="service" items={list.filter((s) => s.active && !s.archived)} />
              <ServiceDialog categories={categories ?? []} />
            </div>
          ) : null
        }
      />
      <ServicesTable
        services={list}
        categories={categories ?? []}
        branch={branch}
        canManage={canManage}
        canBranchPrices={can(me, 'catalog:branch-prices')}
        showArchived={showArchived}
      />
    </div>
  );
}
