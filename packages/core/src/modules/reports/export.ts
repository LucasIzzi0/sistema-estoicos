import {
  DEFAULT_TIMEZONE,
  PAYMENT_METHOD_LABELS,
  POINTS_ENTRY_LABELS,
  reportQuery,
  SALE_ITEM_TYPE_LABELS,
  type ExportKind,
  type ReportQuery,
} from '@estoicos/shared';
import { requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { localDayRange } from '../../time';
import { writeAudit } from '../audit/audit';
import { csvMoney, exportFileName, toCsv } from './calc';
import { branchScope } from './scope';

/**
 * Export a planilla (Fase 8). **Solo el dueño** (decisión del 28/09/2026) y **siempre auditado**:
 * queda registrado qué se bajó, de qué fechas y cuántas filas. Se arma en el servidor y se manda
 * como archivo; no pasa por el navegador ni queda en ningún lado.
 */
export async function exportCsv(
  deps: CoreDeps,
  p: StaffPrincipal,
  kind: ExportKind,
  rawQuery: ReportQuery,
  meta: RequestMeta,
): Promise<{ fileName: string; csv: string; rows: number }> {
  requirePermission(p, 'reports:export');
  const query = reportQuery.parse(rawQuery);
  const scope = branchScope(p, query.branchId);
  const range = localDayRange(query.from, query.to, DEFAULT_TIMEZONE)!;
  const between = { gte: range.startsAt, lt: range.endsAt };
  const orgScope = { organizationId: p.organizationId, ...scope };

  const built = await build(deps, kind, orgScope, between, query);
  const csv = toCsv(built.headers, built.rows);

  await writeAudit(deps.db, {
    organizationId: p.organizationId,
    actor: { type: 'STAFF', userId: p.userId },
    action: 'DATA_EXPORTED',
    entityType: 'Export',
    entityId: kind,
    summary: `Exportó ${kind} del ${query.from} al ${query.to} (${built.rows.length} filas)`,
    after: { kind, from: query.from, to: query.to, branchId: query.branchId ?? null, rows: built.rows.length },
    meta,
  });

  return { fileName: exportFileName(kind, query.from, query.to), csv, rows: built.rows.length };
}

type Scope = { organizationId: string; branchId?: string | { in: string[] } };
type Between = { gte: Date; lt: Date };
type Sheet = { headers: string[]; rows: (string | number | null)[][] };

const localDate = (date: Date | null) =>
  date ? new Intl.DateTimeFormat('en-CA', { timeZone: DEFAULT_TIMEZONE }).format(date) : '';
const localTime = (date: Date | null) =>
  date
    ? new Intl.DateTimeFormat('es-AR', {
        timeZone: DEFAULT_TIMEZONE,
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
    : '';

async function build(
  deps: CoreDeps,
  kind: ExportKind,
  scope: Scope,
  between: Between,
  query: { from: string; to: string },
): Promise<Sheet> {
  switch (kind) {
    case 'ventas': {
      const sales = await deps.db.sale.findMany({
        where: { ...scope, status: 'PAID', paidAt: between },
        include: {
          branch: { select: { name: true } },
          customer: { select: { firstName: true, lastName: true } },
          items: { select: { description: true, quantity: true, type: true } },
          payments: { where: { status: 'APPROVED' }, select: { method: true, amountCents: true } },
        },
        orderBy: { paidAt: 'asc' },
      });
      return {
        headers: [
          'Fecha',
          'Hora',
          'Venta',
          'Sucursal',
          'Cliente',
          'Detalle',
          'Medios de pago',
          'Subtotal',
          'Descuentos',
          'Total',
        ],
        rows: sales.map((s) => [
          localDate(s.paidAt),
          localTime(s.paidAt),
          s.number,
          s.branch.name,
          s.customer ? `${s.customer.firstName} ${s.customer.lastName}`.trim() : 'Sin cliente',
          s.items
            .map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ''}${i.description}`)
            .join(' + '),
          [...new Set(s.payments.map((x) => PAYMENT_METHOD_LABELS[x.method]))].join(' + '),
          csvMoney(s.subtotalCents),
          csvMoney(s.discountCents),
          csvMoney(s.totalCents),
        ]),
      };
    }

    case 'comisiones': {
      const entries = await deps.db.commissionEntry.findMany({
        where: { ...scope, occurredAt: between },
        include: {
          barber: { select: { displayName: true } },
          branch: { select: { name: true } },
          sale: { select: { number: true } },
          saleItem: { select: { description: true } },
          settlementItem: { select: { settlement: { select: { status: true, paidAt: true } } } },
        },
        orderBy: { occurredAt: 'asc' },
      });
      return {
        headers: [
          'Fecha',
          'Sucursal',
          'Barbero',
          'Venta',
          'Concepto',
          'Tipo',
          'Base',
          'Porcentaje',
          'Comisión',
          'Estado',
        ],
        rows: entries.map((e) => [
          localDate(e.occurredAt),
          e.branch.name,
          e.barber.displayName,
          e.sale?.number ?? '',
          e.saleItem?.description ?? '',
          e.itemType ? (SALE_ITEM_TYPE_LABELS[e.itemType] ?? e.itemType) : '',
          csvMoney(e.baseCents),
          `${(e.rateBps / 100).toFixed(2).replace('.', ',')}%`,
          csvMoney(e.amountCents),
          e.settlementItem?.settlement.status === 'PAID' ? 'Pagada' : 'Pendiente',
        ]),
      };
    }

    case 'egresos': {
      const expenses = await deps.db.expense.findMany({
        where: {
          ...scope,
          voidedAt: null,
          occurredOn: { gte: new Date(query.from), lte: new Date(query.to) },
        },
        include: {
          branch: { select: { name: true } },
          category: { select: { name: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { occurredOn: 'asc' },
      });
      return {
        headers: ['Fecha', 'Sucursal', 'Categoría', 'Detalle', 'Medio de pago', 'Monto', 'Lo cargó'],
        rows: expenses.map((e) => [
          localDate(e.occurredOn),
          e.branch?.name ?? 'General',
          e.category.name,
          e.description ?? '',
          PAYMENT_METHOD_LABELS[e.method] ?? e.method,
          csvMoney(e.amountCents),
          e.createdBy?.name ?? '',
        ]),
      };
    }

    case 'clientes': {
      // La ficha del cliente no depende del rango: se exporta el padrón completo, sin anonimizados.
      const customers = await deps.db.customer.findMany({
        where: { organizationId: scope.organizationId, anonymizedAt: null },
        include: {
          consents: { select: { scope: true, granted: true } },
          _count: { select: { appointments: true } },
          pointsEntries: { select: { points: true } },
        },
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      });
      return {
        headers: [
          'Nombre',
          'Apellido',
          'Email',
          'Teléfono',
          'Turnos',
          'Última visita',
          'Cliente desde',
          'Puntos',
          'Acepta promociones',
        ],
        rows: customers.map((c) => [
          c.firstName,
          c.lastName,
          c.email ?? '',
          c.phone ?? '',
          c._count.appointments,
          localDate(c.lastVisitAt),
          localDate(c.createdAt),
          c.pointsEntries.reduce((a, e) => a + e.points, 0),
          c.consents.find((x) => x.scope === 'MARKETING')?.granted ? 'Sí' : 'No',
        ]),
      };
    }

    case 'puntos': {
      const entries = await deps.db.pointsEntry.findMany({
        where: { ...scope, createdAt: between },
        include: {
          customer: { select: { firstName: true, lastName: true } },
          sale: { select: { number: true } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return {
        headers: ['Fecha', 'Cliente', 'Movimiento', 'Puntos', 'Venta', 'Motivo', 'Vencen el'],
        rows: entries.map((e) => [
          localDate(e.createdAt),
          `${e.customer.firstName} ${e.customer.lastName}`.trim(),
          POINTS_ENTRY_LABELS[e.type],
          e.points,
          e.sale?.number ?? '',
          e.reason ?? '',
          localDate(e.expiresAt),
        ]),
      };
    }
  }
}
