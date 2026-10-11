import type { CashSessionDto, CashSessionListItem, ExpenseCategoryDto, SaleListItem } from '@estoicos/shared';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { currentBranch } from '@/lib/branch';
import { CashBoard } from './cash-board';

export const metadata: Metadata = { title: 'Caja y Ventas' };

/** Caja del día de la sucursal elegida, ventas del día y (para admins) cajas anteriores. */
export default async function CashPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'sales:charge')) redirect('/admin');
  const branch = await currentBranch(me);
  if (!branch) return <p className="text-muted-foreground">No tenés sucursales asignadas.</p>;

  const canClose = can(me, 'cash:close');
  const canExpenses = can(me, 'expenses:manage');
  const [current, sales, history, categories] = await Promise.all([
    serverApi<{ session: CashSessionDto | null }>(`/v1/branches/${branch.id}/cash/current`),
    serverApi<SaleListItem[]>(`/v1/branches/${branch.id}/sales`),
    canClose
      ? serverApi<CashSessionListItem[]>(`/v1/branches/${branch.id}/cash/sessions?limit=15`)
      : Promise.resolve({ data: [] as CashSessionListItem[] }),
    canExpenses
      ? serverApi<ExpenseCategoryDto[]>('/v1/expense-categories')
      : Promise.resolve({ data: [] as ExpenseCategoryDto[] }),
  ]);

  return (
    <CashBoard
      branchId={branch.id}
      branchName={branch.name}
      session={current.data?.session ?? null}
      sales={sales.data ?? []}
      history={history.data ?? []}
      categories={(categories.data ?? []).filter((c) => c.active && !c.systemKey)}
      canClose={canClose}
      canExpenses={canExpenses}
    />
  );
}
