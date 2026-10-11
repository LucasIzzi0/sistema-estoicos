import { todayIn, type BarberCommissionSummary, type SettlementListItem } from '@estoicos/shared';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PageTitle } from '@/components/panel/coming-soon';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { CommissionsBoard } from './commissions-board';

export const metadata: Metadata = { title: 'Comisiones' };

export default async function CommissionsPage() {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  if (!can(me, 'commissions:read')) redirect('/admin');
  const today = todayIn('America/Argentina/Buenos_Aires');
  const [{ data: summary }, { data: settlements }] = await Promise.all([
    serverApi<BarberCommissionSummary[]>(`/v1/commissions/summary?until=${today}`),
    serverApi<SettlementListItem[]>('/v1/settlements'),
  ]);

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <Link
        href="/admin/barberos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Barberos
      </Link>
      <PageTitle
        title="Comisiones"
        description="Se generan solas al cobrar cada venta. Liquidá por período, pagá y entregale al barbero el resumen impreso."
      />
      <CommissionsBoard
        today={today}
        summary={summary ?? []}
        settlements={settlements ?? []}
        canSettle={can(me, 'commissions:settle')}
      />
    </div>
  );
}
