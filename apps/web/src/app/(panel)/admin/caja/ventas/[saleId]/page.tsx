import type {
  BarberSummary,
  CashSessionDto,
  MpTerminalDto,
  ProductDto,
  SaleDetail,
  ServiceDto,
} from '@estoicos/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { can } from '@/components/panel/nav';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { SaleEditor } from './sale-editor';

export const metadata: Metadata = { title: 'Venta' };

export default async function SalePage({ params }: { params: Promise<{ saleId: string }> }) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  const { saleId } = await params;
  const { data: sale } = await serverApi<SaleDetail>(`/v1/sales/${saleId}`);
  if (!sale) notFound();

  const [{ data: products }, { data: services }, { data: barbers }, { data: terminals }, { data: cash }] =
    await Promise.all([
      serverApi<ProductDto[]>('/v1/products'),
      serverApi<ServiceDto[]>('/v1/services'),
      serverApi<BarberSummary[]>('/v1/barbers'),
      serverApi<MpTerminalDto[]>('/v1/mercadopago/terminals'),
      serverApi<{ session: CashSessionDto | null }>(`/v1/branches/${sale.branchId}/cash/current`),
    ]);
  const inBranch = <
    T extends {
      active: boolean;
      archived: boolean;
      basePriceCents: number;
      branches: { branchId: string; offered: boolean; priceCentsOverride: number | null }[];
    },
  >(
    list: T[] | null,
  ) =>
    (list ?? [])
      .filter(
        (x) => x.active && !x.archived && x.branches.some((b) => b.branchId === sale.branchId && b.offered),
      )
      .map((x) => ({
        ...x,
        priceCents:
          x.branches.find((b) => b.branchId === sale.branchId)?.priceCentsOverride ?? x.basePriceCents,
      }));

  return (
    <SaleEditor
      initial={sale}
      products={inBranch(products).map((p) => ({ id: p.id, name: p.name, priceCents: p.priceCents }))}
      services={inBranch(services).map((s) => ({ id: s.id, name: s.name, priceCents: s.priceCents }))}
      barbers={(barbers ?? [])
        .filter((b) => b.active && b.branchIds.includes(sale.branchId))
        .map((b) => ({ id: b.id, displayName: b.displayName }))}
      terminals={(terminals ?? []).filter((t) => !t.branchId || t.branchId === sale.branchId)}
      cashOpen={!!cash?.session}
      canOpenCash={can(me, 'cash:open')}
      canDiscount={can(me, 'sales:discount')}
      canVoid={can(me, 'sales:void')}
      canRefund={can(me, 'payments:refund')}
    />
  );
}
