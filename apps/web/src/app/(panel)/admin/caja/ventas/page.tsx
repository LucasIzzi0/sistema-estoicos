import type { BranchSummary, SaleListItem } from '@estoicos/shared';
import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { can } from '@/components/panel/nav';
import { PageHeader } from '@/components/panel/page-header';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { BRANCH_COOKIE } from '@/lib/session-cookies';
import { SalesSearch } from './sales-search';

export const metadata: Metadata = { title: 'Ventas' };

/** Buscar una venta pasada: para anular, devolver o mirar qué se cobró. */
export default async function SalesPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'sales:charge')) redirect('/admin');

  const chosen = (await cookies()).get(BRANCH_COOKIE)?.value;
  const branch: BranchSummary | null = me.branches.find((b) => b.id === chosen) ?? me.branches[0] ?? null;
  if (!branch) redirect('/admin');

  const { data } = await serverApi<SaleListItem[]>(`/v1/branches/${branch.id}/sales`);

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageHeader
        title="Ventas"
        description={`${branch.name}. Buscá por número de venta o por cliente para anular, devolver o revisar lo cobrado.`}
      />
      <SalesSearch branchId={branch.id} initial={data ?? []} />
    </div>
  );
}
