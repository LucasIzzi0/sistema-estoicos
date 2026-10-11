import { MercadoPagoError } from '@estoicos/integrations';
import { refundPaymentBody, type RefundDto, type RefundPaymentBody } from '@estoicos/shared';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { DomainError, Errors } from '../../errors';
import { writeAudit } from '../audit/audit';
import { markAccountError, mpClientFor } from './account';

/**
 * Reintegros. **Solo el dueño** (decisión del 28/09/2026). Un reintegro de Mercado Pago se pide
 * a MP; uno en efectivo sale de la caja abierta. También se puede devolver a **saldo a favor**
 * del cliente, que es inmediato y no depende del saldo de la cuenta de MP (límites en §9.8).
 */
const REFUND_WINDOW_DAYS = { MP_POINT: 90, MP_CHECKOUT: 180, MP_OTHER: 180 } as const;

function toDto(refund: {
  id: string;
  paymentId: string;
  amountCents: bigint;
  destination: 'ORIGINAL_METHOD' | 'CUSTOMER_CREDIT';
  status: 'PENDING' | 'APPROVED' | 'FAILED';
  reason: string;
  createdAt: Date;
  processedAt: Date | null;
  failureReason: string | null;
}): RefundDto {
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    amountCents: Number(refund.amountCents),
    destination: refund.destination,
    status: refund.status,
    reason: refund.reason,
    createdAt: refund.createdAt.toISOString(),
    processedAt: refund.processedAt?.toISOString() ?? null,
    failureReason: refund.failureReason,
  };
}

export async function refundPayment(
  deps: CoreDeps,
  p: StaffPrincipal,
  paymentId: string,
  rawBody: RefundPaymentBody,
  meta: RequestMeta,
): Promise<RefundDto> {
  requirePermission(p, 'payments:refund');
  const body = refundPaymentBody.parse(rawBody);
  const payment = await deps.db.payment.findFirst({
    where: { id: paymentId, organizationId: p.organizationId },
    include: { mpPayment: true, refunds: true },
  });
  if (!payment) throw Errors.notFound('No encontramos ese cobro.');
  requireBranchAccess(p, payment.branchId);
  if (payment.status !== 'APPROVED' && payment.status !== 'PARTIALLY_REFUNDED') {
    throw Errors.conflict('Solo se puede devolver un cobro aprobado.');
  }

  const alreadyRefunded = payment.refunds
    .filter((r) => r.status !== 'FAILED')
    .reduce((a, r) => a + r.amountCents, 0n);
  const available = payment.amountCents - alreadyRefunded;
  const amount =
    body.amountCents === null || body.amountCents === undefined ? available : BigInt(body.amountCents);
  if (amount <= 0n) throw Errors.invalid('El monto tiene que ser mayor a $0.');
  if (amount > available) {
    throw Errors.invalid(
      `De ese cobro quedan $${(Number(available) / 100).toLocaleString('es-AR')} para devolver.`,
    );
  }

  const window = REFUND_WINDOW_DAYS[payment.method as keyof typeof REFUND_WINDOW_DAYS];
  if (window && payment.approvedAt) {
    const days = (deps.now().getTime() - payment.approvedAt.getTime()) / 86_400_000;
    if (days > window && body.destination === 'ORIGINAL_METHOD') {
      throw Errors.conflict(
        `Mercado Pago solo permite devolver hasta ${window} días después del cobro. Podés dejarlo como saldo a favor.`,
      );
    }
  }
  if (body.destination === 'CUSTOMER_CREDIT' && !payment.customerId) {
    throw Errors.invalid('Ese cobro no tiene cliente: no se puede dejar como saldo a favor.');
  }
  if (body.destination === 'ORIGINAL_METHOD' && payment.method === 'CASH') {
    const session = await deps.db.cashSession.findFirst({
      where: { branchId: payment.branchId, status: 'OPEN' },
    });
    if (!session) {
      throw new DomainError(
        'CASH_CLOSED',
        'Abrí la caja: el efectivo se devuelve desde la caja del día.',
        409,
      );
    }
  }
  const now = deps.now();

  // El reintegro queda registrado antes de pedirlo a MP: si algo falla, se ve por qué.
  const refund = await deps.db.$transaction(async (tx) => {
    const session =
      body.destination === 'ORIGINAL_METHOD' && payment.method === 'CASH'
        ? await tx.cashSession.findFirst({ where: { branchId: payment.branchId, status: 'OPEN' } })
        : null;
    return tx.refund.create({
      data: {
        paymentId: payment.id,
        amountCents: amount,
        destination: body.destination,
        status: 'PENDING',
        reason: body.reason,
        cashSessionId: session?.id ?? null,
        createdById: p.userId,
      },
    });
  });

  const isMercadoPago = payment.mpPayment && body.destination === 'ORIGINAL_METHOD';
  if (isMercadoPago) {
    const account = await deps.db.mpAccount.findUniqueOrThrow({
      where: { id: payment.mpPayment!.mpAccountId },
    });
    try {
      const result = await mpClientFor(deps, account).refundPayment(
        payment.mpPayment!.externalId,
        amount === payment.amountCents ? undefined : Number(amount),
      );
      await deps.db.refund.update({
        where: { id: refund.id },
        data: { status: 'APPROVED', mpRefundId: result.id, processedAt: deps.now() },
      });
    } catch (error) {
      const message = error instanceof MercadoPagoError ? error.message : String(error);
      if (error instanceof MercadoPagoError && error.invalidToken)
        await markAccountError(deps, account.id, message);
      await deps.db.refund.update({
        where: { id: refund.id },
        data: { status: 'FAILED', failureReason: message.slice(0, 300) },
      });
      throw new DomainError('MP_REFUND_FAILED', `Mercado Pago no pudo devolver: ${message}`, 503);
    }
  } else {
    await deps.db.refund.update({ where: { id: refund.id }, data: { status: 'APPROVED', processedAt: now } });
  }

  await deps.db.$transaction(async (tx) => {
    const refunded = alreadyRefunded + amount;
    await tx.payment.update({
      where: { id: payment.id },
      data: {
        refundedCents: refunded,
        status: refunded >= payment.amountCents ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
      },
    });
    if (payment.saleId) {
      const sale = await tx.sale.findUniqueOrThrow({ where: { id: payment.saleId } });
      await tx.sale.update({
        where: { id: sale.id },
        data: { refundedCents: sale.refundedCents + amount },
      });
    }
    if (body.destination === 'CUSTOMER_CREDIT') {
      await tx.customerCreditEntry.create({
        data: {
          organizationId: p.organizationId,
          customerId: payment.customerId!,
          branchId: payment.branchId,
          type: 'REFUND_TO_CREDIT',
          amountCents: amount,
          paymentId: payment.id,
          refundId: refund.id,
          saleId: payment.saleId,
          createdById: p.userId,
          idempotencyKey: `refund:${refund.id}`,
        },
      });
    }
    await writeAudit(tx, {
      organizationId: p.organizationId,
      branchId: payment.branchId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'PAYMENT_REFUNDED',
      entityType: 'Payment',
      entityId: payment.id,
      summary: `Reintegro de $${(Number(amount) / 100).toLocaleString('es-AR')} (${
        body.destination === 'CUSTOMER_CREDIT' ? 'saldo a favor' : 'al medio original'
      })`,
      after: { amountCents: Number(amount), destination: body.destination, method: payment.method },
      reason: body.reason,
      meta,
    });
  });

  const saved = await deps.db.refund.findUniqueOrThrow({ where: { id: refund.id } });
  return toDto(saved);
}

export async function listPaymentRefunds(
  deps: CoreDeps,
  p: StaffPrincipal,
  paymentId: string,
): Promise<RefundDto[]> {
  requirePermission(p, 'sales:charge');
  const payment = await deps.db.payment.findFirst({
    where: { id: paymentId, organizationId: p.organizationId },
    include: { refunds: { orderBy: { createdAt: 'desc' } } },
  });
  if (!payment) throw Errors.notFound('No encontramos ese cobro.');
  requireBranchAccess(p, payment.branchId);
  return payment.refunds.map(toDto);
}
