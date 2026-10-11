import { todayIn, type ExpenseCategoryDto, type ExpenseDto } from '@estoicos/shared';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { ExpenseDialog } from '../expense-dialog';
import { ExpensesTable } from './expenses-table';

export const metadata: Metadata = { title: 'Egresos' };

type Props = { searchParams: Promise<{ mes?: string }> };

export default async function ExpensesPage({ searchParams }: Props) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'expenses:manage')) redirect('/admin/caja');
  const { mes } = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(mes ?? '')
    ? mes!
    : todayIn('America/Argentina/Buenos_Aires').slice(0, 7);
  const [{ data: expenses }, { data: categories }] = await Promise.all([
    serverApi<ExpenseDto[]>(`/v1/expenses?month=${month}`),
    serverApi<ExpenseCategoryDto[]>('/v1/expense-categories'),
  ]);

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <Link
        href="/admin/caja"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Caja y Ventas
      </Link>
      <PageTitle
        title="Egresos"
        description="Gastos del mes, de la caja o pagados aparte (alquiler, servicios, sueldos). Las comisiones pagadas aparecen solas."
        actions={
          <ExpenseDialog
            branchId={me.branches[0]?.id ?? null}
            categories={(categories ?? []).filter((c) => c.active && !c.systemKey)}
            branches={me.accessLevel === 'OWNER' ? me.branches : undefined}
          />
        }
      />
      <ExpensesTable month={month} expenses={expenses ?? []} />
    </div>
  );
}
