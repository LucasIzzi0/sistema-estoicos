import type { StockItem } from '@estoicos/shared';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { currentBranch } from '@/lib/branch';
import { StockTable } from './stock-table';

export const metadata: Metadata = { title: 'Stock' };

export default async function StockPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  const branch = await currentBranch(me);
  if (!branch) return <p className="text-muted-foreground">No tenés sucursales asignadas.</p>;
  const { data } = await serverApi<StockItem[]>(`/v1/branches/${branch.id}/stock`);

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <Link
        href="/admin/productos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Productos
      </Link>
      <PageTitle
        title={`Stock · ${branch.name}`}
        description="Se descuenta solo al cobrar. Compras y ajustes quedan en el historial con quién y por qué."
      />
      <StockTable branchId={branch.id} initial={data ?? []} canAdjust={can(me, 'stock:adjust')} />
    </div>
  );
}
