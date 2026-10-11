import { SETTLEMENT_STATUS_LABELS, type SettlementDto } from '@estoicos/shared';
import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getStaffMe, serverApi } from '@/lib/api/server';
import { formatBps, formatCents, formatDateTime, formatDay } from '@/lib/format';
import { PrintButton } from './print-button';

export const metadata: Metadata = { title: 'Resumen de comisiones' };

/**
 * Resumen de la liquidación para entregarle al barbero (impreso o como PDF por WhatsApp).
 * Los barberos no usan el sistema (decisión del 25/09/2026). No incluye datos de clientes.
 */
export default async function SettlementPrintPage({ params }: { params: Promise<{ settlementId: string }> }) {
  const me = await getStaffMe();
  if (!me) redirect('/staff/ingresar');
  const { settlementId } = await params;
  const { data: s } = await serverApi<SettlementDto>(`/v1/settlements/${settlementId}`);
  if (!s) notFound();

  return (
    <main className="mx-auto grid max-w-2xl gap-6 bg-white p-8 text-black print:p-0">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold uppercase tracking-widest text-[#8a1f2d]">{s.organizationName}</p>
          <h1 className="text-2xl font-extrabold">Liquidación de comisiones</h1>
          <p className="text-sm">
            {s.barberName} · del {formatDay(s.periodStart)} al {formatDay(s.periodEnd)}
          </p>
        </div>
        <PrintButton />
      </div>

      <table className="w-full text-sm">
        <tbody>
          {(
            [
              ['Servicios', s.byType.services],
              ['Productos', s.byType.products],
              ['Propinas', s.byType.tips],
              ['Ajustes', s.byType.adjustments],
            ] as [string, number][]
          )
            .filter(([label, value]) => value !== 0 || label === 'Servicios' || label === 'Productos')
            .map(([label, value]) => (
              <tr key={label} className="border-b">
                <td className="py-1.5">{label}</td>
                <td className="py-1.5 text-right tabular-nums">{formatCents(value)}</td>
              </tr>
            ))}
          <tr className="text-base font-bold">
            <td className="pt-2">Total</td>
            <td className="pt-2 text-right tabular-nums">{formatCents(s.totalCents)}</td>
          </tr>
        </tbody>
      </table>

      <section>
        <h2 className="mb-2 text-sm font-bold uppercase">Detalle</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left">
              <th className="py-1 font-semibold">Fecha</th>
              <th className="py-1 font-semibold">Concepto</th>
              <th className="py-1 text-right font-semibold">Base</th>
              <th className="py-1 text-right font-semibold">%</th>
              <th className="py-1 text-right font-semibold">Comisión</th>
            </tr>
          </thead>
          <tbody>
            {s.entries.map((e) => (
              <tr key={e.id} className="border-b border-neutral-200">
                <td className="py-1">{formatDateTime(e.occurredAt)}</td>
                <td className="py-1">
                  {e.description}
                  {e.saleNumber ? ` (venta #${e.saleNumber})` : ''}
                </td>
                <td className="py-1 text-right tabular-nums">{formatCents(e.baseCents)}</td>
                <td className="py-1 text-right tabular-nums">{formatBps(e.rateBps)}</td>
                <td className="py-1 text-right tabular-nums">{formatCents(e.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <p className="text-xs text-neutral-600">
        Estado: {SETTLEMENT_STATUS_LABELS[s.status]}
        {s.paidAt ? ` el ${formatDateTime(s.paidAt)}` : ''}. Comisión calculada sobre lo cobrado en cada
        línea, después de descuentos. Generado el {formatDateTime(new Date().toISOString())}.
      </p>
      <div className="mt-8 grid grid-cols-2 gap-12 text-xs">
        <p className="border-t pt-1">Firma del barbero</p>
        <p className="border-t pt-1">Firma de la barbería</p>
      </div>
    </main>
  );
}
