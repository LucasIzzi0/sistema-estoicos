import type { SettlementDto } from '@estoicos/shared';
import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { SettlementView } from './settlement-view';

export const metadata: Metadata = { title: 'Liquidación' };

export default async function SettlementPage({ params }: { params: Promise<{ settlementId: string }> }) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  const { settlementId } = await params;
  const { data } = await serverApi<SettlementDto>(`/v1/settlements/${settlementId}`);
  if (!data) notFound();
  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <Link
        href="/admin/barberos/comisiones"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Comisiones
      </Link>
      <SettlementView settlement={data} canSettle={can(me, 'commissions:settle')} branches={me.branches} />
    </div>
  );
}
