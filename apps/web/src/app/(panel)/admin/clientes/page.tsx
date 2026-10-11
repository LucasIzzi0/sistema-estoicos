import type { CustomerListItem } from '@estoicos/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { CustomerSearch } from './customer-search';
import { NewCustomerDialog } from './new-customer-dialog';

export const metadata: Metadata = { title: 'Clientes' };

export default async function CustomersPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  const { data: recent } = await serverApi<CustomerListItem[]>('/v1/customers?limit=30');

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <PageTitle
        title="Clientes"
        description="Los clientes son de la marca: su ficha y sus puntos valen en todas las sucursales."
        actions={can(me, 'customers:create') ? <NewCustomerDialog /> : null}
      />
      <CustomerSearch initial={recent ?? []} />
    </div>
  );
}
