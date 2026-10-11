import type { MpPayment, Prisma } from '@estoicos/db';
import {
  assignPaymentBody,
  mpInboxQuery,
  type AssignPaymentBody,
  type MpInboxItem,
  type MpPaymentDto,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors } from '../../errors';
import { writeAudit } from '../audit/audit';
import { lockSale, settleSaleIfCovered } from '../sales/sales';

/**
 * Conciliación (docs/fase-0/01-arquitectura.md §9.6). Todo pago aprobado de la cuenta termina
 * vinculado a un cobro, marcado como "otro ingreso" o ignorado con motivo. La bandeja sugiere
 * candidatos por monto, hora y sucursal, pero **decide una persona** y queda auditado.
 */
type Row = MpPayment & { branch: { name: string } | null; payment: { saleId: string | null } | null };

const include = {
  branch: { select: { name: true } },
  payment: { select: { saleId: true } },
} as const satisfies Prisma.MpPaymentInclude;

async function toDto(deps: CoreDeps, row: Row): Promise<MpPaymentDto> {
  const sale = row.payment?.saleId
    ? await deps.db.sale.findUnique({ where: { id: row.payment.saleId }, select: { id: true, number: true } })
    : null;
  return {
    id: row.id,
    externalId: row.externalId,
    status: row.status,
    statusDetail: row.statusDetail,
    amountCents: Number(row.amountCents),
    feeCents: row.feeCents === null ? null : Number(row.feeCents),
    netReceivedCents: row.netReceivedCents === null ? null : Number(row.netReceivedCents),
    refundedCents: Number(row.refundedCents),
    paymentMethod: row.paymentMethodId,
    description: row.description,
    payerName: row.payerName,
    externalReference: row.externalReference,
    branchId: row.branchId,
    branchName: row.branch?.name ?? null,
    dateCreated: row.dateCreated.toISOString(),
    dateApproved: row.dateApproved?.toISOString() ?? null,
    reconciliationStatus: row.reconciliationStatus,
    reconciliationNote: row.reconciliationNote,
    saleId: sale?.id ?? null,
    saleNumber: sale?.number ?? null,
  };
}

/**
 * Candidatos para un pago sin asignar: mismo monto, ±15 minutos, misma sucursal.
 * Se ordenan por cercanía de hora. Nunca se asigna solo: es una ayuda para el admin.
 */
async function suggestionsFor(
  deps: CoreDeps,
  p: StaffPrincipal,
  row: Row,
): Promise<MpInboxItem['suggestions']> {
  const when = row.dateApproved ?? row.dateCreated;
  const window = { gte: new Date(when.getTime() - 15 * 60_000), lte: new Date(when.getTime() + 15 * 60_000) };
  const branchFilter = row.branchId ? { branchId: row.branchId } : { branchId: { in: p.branchIds } };

  const sales = await deps.db.sale.findMany({
    where: {
      organizationId: p.organizationId,
      ...branchFilter,
      status: { in: ['OPEN', 'PAID'] },
      OR: [{ createdAt: window }, { paidAt: window }],
    },
    include: { customer: { select: { firstName: true, lastName: true } } },
    take: 20,
  });

  return sales
    .map((sale) => {
      const reasons: string[] = [];
      if (sale.totalCents === row.amountCents) reasons.push('mismo monto');
      const at = sale.paidAt ?? sale.createdAt;
      const minutes = Math.abs(at.getTime() - when.getTime()) / 60_000;
      if (minutes <= 15) reasons.push(minutes < 1 ? 'a la misma hora' : `a ${Math.round(minutes)} min`);
      if (row.branchId && sale.branchId === row.branchId) reasons.push('misma sucursal');
      return {
        kind: 'SALE' as const,
        id: sale.id,
        label: `Venta #${sale.number}${sale.customer ? ` · ${sale.customer.firstName} ${sale.customer.lastName}`.trimEnd() : ''}`,
        amountCents: Number(sale.totalCents),
        when: at.toISOString(),
        reasons,
        score: (sale.totalCents === row.amountCents ? 100 : 0) - minutes,
      };
    })
    .filter((s) => s.reasons.length > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ score: _score, ...s }) => s);
}

export async function listMpInbox(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawQuery: z.input<typeof mpInboxQuery>,
): Promise<MpInboxItem[]> {
  requirePermission(p, 'mercadopago:reconcile');
  const query = mpInboxQuery.parse(rawQuery);
  const rows = await deps.db.mpPayment.findMany({
    where: {
      organizationId: p.organizationId,
      reconciliationStatus: query.status,
      ...(p.accessLevel === 'OWNER' ? {} : { OR: [{ branchId: { in: p.branchIds } }, { branchId: null }] }),
    },
    include,
    orderBy: { dateCreated: 'desc' },
    take: query.limit,
  });
  return Promise.all(
    rows.map(async (row) => ({
      ...(await toDto(deps, row)),
      suggestions: query.status === 'UNASSIGNED' ? await suggestionsFor(deps, p, row) : [],
    })),
  );
}

/** Cuántos pagos esperan una decisión (para el aviso en el panel). */
export async function countUnassignedPayments(deps: CoreDeps, organizationId: string): Promise<number> {
  return deps.db.mpPayment.count({ where: { organizationId, reconciliationStatus: 'UNASSIGNED' } });
}

/**
 * Asigna un pago de Mercado Pago: a una venta, a la seña de un turno, a saldo a favor de un
 * cliente, como otro ingreso, o se ignora con motivo. Siempre queda auditado.
 */
export async function assignMpPayment(
  deps: CoreDeps,
  p: StaffPrincipal,
  mpPaymentId: string,
  rawBody: AssignPaymentBody,
  meta: RequestMeta,
): Promise<MpPaymentDto> {
  requirePermission(p, 'mercadopago:reconcile');
  const body = assignPaymentBody.parse(rawBody);
  const row = await deps.db.mpPayment.findFirst({
    where: { id: mpPaymentId, organizationId: p.organizationId },
    include,
  });
  if (!row) throw Errors.notFound('No encontramos ese pago.');
  if (row.payment) throw Errors.conflict('Ese pago ya está vinculado a un cobro.');
  if (!['UNASSIGNED', 'IGNORED', 'OTHER_INCOME'].includes(row.reconciliationStatus)) {
    throw Errors.conflict('Ese pago ya está conciliado.');
  }
  const now = deps.now();
  const amount = row.amountCents;
  let summary = '';

  await deps.db.$transaction(async (tx) => {
    if (body.target === 'SALE') {
      const sale = await tx.sale.findFirst({ where: { id: body.saleId, organizationId: p.organizationId } });
      if (!sale) throw Errors.invalid('No encontramos esa venta.');
      if (sale.status === 'VOIDED') throw Errors.conflict('Esa venta está anulada.');
      await lockSale(tx, sale.id);
      const payment = await tx.payment.create({
        data: {
          organizationId: p.organizationId,
          branchId: sale.branchId,
          purpose: 'SALE',
          method: 'MP_OTHER',
          status: 'APPROVED',
          amountCents: amount,
          saleId: sale.id,
          customerId: sale.customerId,
          mpPaymentId: row.id,
          reference: row.externalId,
          receivedById: p.userId,
          approvedAt: row.dateApproved ?? now,
        },
      });
      await settleSaleIfCovered(tx, { saleId: sale.id, userId: p.userId, now, config: deps.config });
      summary = `Pago de Mercado Pago asignado a la venta #${sale.number}`;
      void payment;
    } else if (body.target === 'APPOINTMENT_DEPOSIT') {
      const appointment = await tx.appointment.findFirst({
        where: { id: body.appointmentId, organizationId: p.organizationId },
      });
      if (!appointment) throw Errors.invalid('No encontramos ese turno.');
      await tx.payment.create({
        data: {
          organizationId: p.organizationId,
          branchId: appointment.branchId,
          purpose: 'DEPOSIT',
          method: 'MP_CHECKOUT',
          status: 'APPROVED',
          amountCents: amount,
          appointmentId: appointment.id,
          customerId: appointment.customerId,
          mpPaymentId: row.id,
          reference: row.externalId,
          receivedById: p.userId,
          approvedAt: row.dateApproved ?? now,
        },
      });
      await tx.appointment.update({
        where: { id: appointment.id },
        data: {
          depositStatus: 'PAID',
          ...(appointment.status === 'PENDING_PAYMENT' ? { status: 'BOOKED' } : {}),
        },
      });
      summary = 'Pago de Mercado Pago asignado como seña de un turno';
    } else if (body.target === 'CUSTOMER_CREDIT') {
      const customer = await tx.customer.findFirst({
        where: { id: body.customerId, organizationId: p.organizationId, anonymizedAt: null },
      });
      if (!customer) throw Errors.invalid('No encontramos ese cliente.');
      const payment = await tx.payment.create({
        data: {
          organizationId: p.organizationId,
          branchId: row.branchId ?? p.branchIds[0]!,
          purpose: 'CUSTOMER_CREDIT',
          method: 'MP_OTHER',
          status: 'APPROVED',
          amountCents: amount,
          customerId: customer.id,
          mpPaymentId: row.id,
          reference: row.externalId,
          receivedById: p.userId,
          approvedAt: row.dateApproved ?? now,
        },
      });
      await tx.customerCreditEntry.create({
        data: {
          organizationId: p.organizationId,
          customerId: customer.id,
          branchId: row.branchId,
          type: 'TOPUP',
          amountCents: amount,
          paymentId: payment.id,
          createdById: p.userId,
          idempotencyKey: `mp-topup:${row.id}`,
        },
      });
      summary =
        `Pago de Mercado Pago cargado como saldo a favor de ${customer.firstName} ${customer.lastName}`.trim();
    } else if (body.target === 'OTHER_INCOME') {
      await tx.payment.create({
        data: {
          organizationId: p.organizationId,
          branchId: row.branchId ?? p.branchIds[0]!,
          purpose: 'OTHER_INCOME',
          method: 'MP_OTHER',
          status: 'APPROVED',
          amountCents: amount,
          description: body.description,
          mpPaymentId: row.id,
          reference: row.externalId,
          receivedById: p.userId,
          approvedAt: row.dateApproved ?? now,
        },
      });
      summary = `Pago de Mercado Pago marcado como otro ingreso: ${body.description}`;
    } else {
      summary = `Pago de Mercado Pago ignorado: ${body.reason}`;
    }

    await tx.mpPayment.update({
      where: { id: row.id },
      data: {
        reconciliationStatus:
          body.target === 'IGNORED'
            ? 'IGNORED'
            : body.target === 'OTHER_INCOME'
              ? 'OTHER_INCOME'
              : 'MANUALLY_ASSIGNED',
        reconciledById: p.userId,
        reconciledAt: now,
        reconciliationNote:
          body.target === 'IGNORED' ? body.reason : body.target === 'OTHER_INCOME' ? body.description : null,
      },
    });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      branchId: row.branchId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'MP_PAYMENT_RECONCILED',
      entityType: 'MpPayment',
      entityId: row.id,
      summary,
      after: { target: body.target, amountCents: Number(amount), mpPaymentId: row.externalId },
      meta,
    });
  });

  const updated = await deps.db.mpPayment.findUniqueOrThrow({ where: { id: row.id }, include });
  return toDto(deps, updated);
}
