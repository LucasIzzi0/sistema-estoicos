import { randomUUID } from 'node:crypto';
import type { MpOrder, Prisma } from '@estoicos/db';
import { MercadoPagoError, type MpOrderDto as MpOrderApiDto } from '@estoicos/integrations';
import { chargeWithPointBody, type ChargeWithPointBody, type MpOrderDto } from '@estoicos/shared';
import { requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps } from '../../deps';
import { DomainError, Errors, isUniqueViolation } from '../../errors';
import { lockSale, requireOpenCashSession, settleSaleIfCovered } from '../sales/sales';
import { markAccountError, mpClientFor, requireActiveAccount } from './account';
import { syncPaymentById } from './mirror';

/**
 * Cobro con Point (API de Orders). El flujo completo está en docs/fase-0/01-arquitectura.md §9.3:
 * se crea el cobro PENDING y la orden en la misma transacción, se manda a Mercado Pago con
 * X-Idempotency-Key (un corte de red no duplica la orden) y la terminal muestra el cobro sola.
 * El webhook confirma; la pantalla mientras tanto consulta el estado.
 */

/** Estado crudo de MP → estado nuestro. Tabla de docs/fase-0/01-arquitectura.md §9.3. */
export function mapOrderStatus(mpStatus: string | null | undefined): MpOrderDto['status'] {
  switch (mpStatus) {
    case 'processed':
      return 'APPROVED';
    case 'failed':
      return 'REJECTED';
    case 'canceled':
      return 'CANCELED';
    case 'expired':
      return 'EXPIRED';
    case 'refunded':
      return 'REFUNDED';
    default:
      // created, at_terminal, action_required y cualquier estado nuevo: sigue esperando.
      return 'PENDING';
  }
}

/** Solo se cancela desde el sistema mientras la terminal no tomó el cobro (regla de MP). */
export function isCancelable(order: { status: string; mpStatus: string | null }): boolean {
  return order.status === 'PENDING' && (order.mpStatus === null || order.mpStatus === 'created');
}

function toDto(order: MpOrder & { terminal: { label: string | null; externalId: string } }): MpOrderDto {
  return {
    id: order.id,
    saleId: order.saleId,
    terminalId: order.terminalId,
    terminalLabel: order.terminal.label ?? order.terminal.externalId,
    status: order.status,
    mpStatus: order.mpStatus,
    mpStatusDetail: order.mpStatusDetail,
    amountCents: Number(order.amountCents),
    paidAmountCents: order.paidAmountCents === null ? null : Number(order.paidAmountCents),
    expiresAt: order.expiresAt?.toISOString() ?? null,
    cancelable: isCancelable(order),
    createdAt: order.createdAt.toISOString(),
  };
}

const orderInclude = { terminal: { select: { label: true, externalId: true } } } as const;

/**
 * Manda el cobro a la terminal. Deja el cobro en PENDING: la venta se marca pagada recién
 * cuando el webhook (o el sondeo) confirma que Mercado Pago aprobó.
 */
export async function chargeSaleWithPoint(
  deps: CoreDeps,
  p: StaffPrincipal,
  saleId: string,
  rawBody: ChargeWithPointBody,
): Promise<MpOrderDto> {
  requirePermission(p, 'sales:charge');
  const body = chargeWithPointBody.parse(rawBody);
  const account = await requireActiveAccount(deps, p.organizationId);

  const sale = await deps.db.sale.findFirst({ where: { id: saleId, organizationId: p.organizationId } });
  if (!sale) throw Errors.notFound('No encontramos esa venta.');
  if (sale.status !== 'OPEN') throw Errors.conflict('La venta ya no está abierta.');
  const terminal = await deps.db.mpTerminal.findFirst({
    where: { id: body.terminalId, mpAccountId: account.id, active: true },
  });
  if (!terminal) throw Errors.invalid('Esa terminal no está disponible.');
  if (terminal.branchId && terminal.branchId !== sale.branchId) {
    throw Errors.invalid('Esa terminal es de otra sucursal.');
  }
  if (terminal.operatingMode !== 'PDV') {
    throw new DomainError(
      'TERMINAL_NOT_READY',
      'La terminal todavía no está en modo PDV. Activala desde Pagos Mercado Pago y reiniciala.',
      409,
    );
  }
  const amount = BigInt(body.amountCents);
  const remaining = sale.totalCents - sale.paidCents;
  if (amount > remaining) throw Errors.invalid('El monto es mayor a lo que falta cobrar.');

  // Referencia única por orden (MP lo exige): "sale_<id sin guiones>_<intento>".
  const attempt = (await deps.db.mpOrder.count({ where: { saleId } })) + 1;
  const externalReference = `sale_${sale.id.replace(/-/g, '')}_${attempt}`.slice(0, 64);
  const idempotencyKey = randomUUID();
  const settings = await deps.db.organizationSettings.findUnique({
    where: { organizationId: p.organizationId },
  });
  const ttlMinutes = settings?.pointOrderTtlMinutes ?? 10;
  const now = deps.now();

  let created: { orderId: string };
  try {
    created = await deps.db.$transaction(async (tx) => {
      const session = await requireOpenCashSession(tx, p.organizationId, sale.branchId);
      const payment = await tx.payment.create({
        data: {
          organizationId: p.organizationId,
          branchId: sale.branchId,
          purpose: 'SALE',
          method: 'MP_POINT',
          status: 'PENDING',
          amountCents: amount,
          saleId: sale.id,
          customerId: sale.customerId,
          cashSessionId: session?.id ?? null,
          receivedById: p.userId,
        },
      });
      const order = await tx.mpOrder.create({
        data: {
          branchId: sale.branchId,
          mpAccountId: account.id,
          terminalId: terminal.id,
          saleId: sale.id,
          paymentId: payment.id,
          externalReference,
          idempotencyKey,
          amountCents: amount,
          expiresAt: new Date(now.getTime() + ttlMinutes * 60_000),
          createdById: p.userId,
        },
      });
      return { orderId: order.id };
    });
  } catch (error) {
    // El índice parcial de la base impide dos órdenes pendientes en la misma terminal.
    if (isUniqueViolation(error)) {
      throw new DomainError('TERMINAL_BUSY', 'Esa terminal ya tiene un cobro esperando.', 409);
    }
    throw error;
  }

  try {
    const remote = await mpClientFor(deps, account).createOrder({
      terminalId: terminal.externalId,
      amount: (Number(amount) / 100).toFixed(2),
      externalReference,
      idempotencyKey,
      expirationSeconds: ttlMinutes * 60,
      description: `Venta #${sale.number}`,
    });
    await deps.db.mpOrder.update({
      where: { id: created.orderId },
      data: {
        externalId: remote.id,
        mpStatus: remote.status,
        mpStatusDetail: remote.status_detail ?? null,
        status: mapOrderStatus(remote.status),
        lastPayload: remote as unknown as Prisma.InputJsonValue,
        lastSyncedAt: deps.now(),
      },
    });
  } catch (error) {
    // Si MP no aceptó la orden, se deshace todo: la terminal queda libre para reintentar.
    await deps.db
      .$transaction(async (tx) => {
        await tx.mpOrder.delete({ where: { id: created.orderId } });
        await tx.payment.deleteMany({ where: { mpOrder: { id: created.orderId } } });
      })
      .catch(async () => {
        await deps.db.mpOrder.update({
          where: { id: created.orderId },
          data: { status: 'CANCELED', mpStatus: 'canceled', mpStatusDetail: 'no_enviada' },
        });
      });
    if (error instanceof MercadoPagoError) {
      if (error.invalidToken) await markAccountError(deps, account.id, error.message);
      if (error.terminalBusy) {
        throw new DomainError('TERMINAL_BUSY', 'Esa terminal ya tiene un cobro esperando.', 409);
      }
      throw new DomainError('MP_UNAVAILABLE', `Mercado Pago rechazó el cobro: ${error.message}`, 503);
    }
    throw error;
  }

  const saved = await deps.db.mpOrder.findUniqueOrThrow({
    where: { id: created.orderId },
    include: orderInclude,
  });
  return toDto(saved);
}

async function loadOrder(deps: CoreDeps, p: StaffPrincipal, orderId: string) {
  const order = await deps.db.mpOrder.findFirst({
    where: { id: orderId, account: { organizationId: p.organizationId } },
    include: orderInclude,
  });
  if (!order) throw Errors.notFound('No encontramos ese cobro.');
  return order;
}

/**
 * Estado del cobro para la pantalla (se consulta cada 2 s). Si pasaron más de 2 segundos sin
 * noticias, se le pregunta a Mercado Pago: así no se depende solo del webhook.
 */
export async function getPointOrder(deps: CoreDeps, p: StaffPrincipal, orderId: string): Promise<MpOrderDto> {
  requirePermission(p, 'sales:charge');
  const order = await loadOrder(deps, p, orderId);
  if (order.status !== 'PENDING' || !order.externalId) return toDto(order);

  const stale = !order.lastSyncedAt || deps.now().getTime() - order.lastSyncedAt.getTime() > 2_000;
  if (stale) {
    const account = await deps.db.mpAccount.findUniqueOrThrow({ where: { id: order.mpAccountId } });
    try {
      const remote = await mpClientFor(deps, account).getOrder(order.externalId);
      await applyOrderUpdate(deps, order.id, remote);
      // Si Mercado Pago ya aprobó, se cierra la venta acá mismo: la pantalla no espera al webhook.
      if (mapOrderStatus(remote.status) === 'APPROVED') {
        await applyApprovedOrder(deps, order.id);
        // El pago espejo se guarda ya: así la conciliación lo da por vinculado desde el minuto cero.
        const reference = remote.transactions?.payments?.[0]?.reference_id;
        if (reference) {
          await syncPaymentById(deps, account.mpUserId, reference, 'ORDER_FETCH').catch(() => undefined);
        }
      }
      return toDto(await loadOrder(deps, p, orderId));
    } catch (error) {
      // Si MP no responde, se muestra lo último que sabemos: el webhook o el barrido lo resuelven.
      deps.log.warn({ orderId, err: String(error) }, 'No se pudo consultar la orden en Mercado Pago');
    }
  }
  return toDto(order);
}

export async function cancelPointOrder(
  deps: CoreDeps,
  p: StaffPrincipal,
  orderId: string,
): Promise<MpOrderDto> {
  requirePermission(p, 'sales:charge');
  const order = await loadOrder(deps, p, orderId);
  if (order.status !== 'PENDING') throw Errors.conflict('Ese cobro ya no está esperando.');
  if (!isCancelable(order)) {
    throw Errors.conflict('El cliente ya está pagando: la cancelación se hace desde la terminal.');
  }
  const account = await deps.db.mpAccount.findUniqueOrThrow({ where: { id: order.mpAccountId } });
  await deps.db.mpOrder.update({ where: { id: order.id }, data: { cancelRequestedAt: deps.now() } });

  if (order.externalId) {
    try {
      const remote = await mpClientFor(deps, account).cancelOrder(order.externalId);
      await applyOrderUpdate(deps, order.id, remote);
    } catch (error) {
      if (error instanceof MercadoPagoError && error.status === 409) {
        throw Errors.conflict('Mercado Pago ya no permite cancelarla: seguí desde la terminal.');
      }
      throw new DomainError('MP_UNAVAILABLE', 'No pudimos cancelar en Mercado Pago. Probá de nuevo.', 503);
    }
  } else {
    await closeOrderAsFailed(deps, order.id, 'CANCELED', 'canceled', 'sin_enviar');
  }
  return toDto(await loadOrder(deps, p, orderId));
}

/** Órdenes que la pantalla o el worker tienen que revisar (pendientes sin noticias). */
export async function findStalePointOrders(deps: CoreDeps, olderThanMs: number, limit = 50) {
  const cutoff = new Date(deps.now().getTime() - olderThanMs);
  return deps.db.mpOrder.findMany({
    where: {
      status: 'PENDING',
      externalId: { not: null },
      OR: [{ lastSyncedAt: null }, { lastSyncedAt: { lt: cutoff } }],
    },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
}

/** Marca la orden y su cobro como no cobrados (rechazo, cancelación, vencimiento). */
export async function closeOrderAsFailed(
  deps: CoreDeps,
  orderId: string,
  status: 'REJECTED' | 'CANCELED' | 'EXPIRED',
  mpStatus: string,
  detail: string | null,
): Promise<void> {
  await deps.db.$transaction(async (tx) => {
    const order = await tx.mpOrder.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== 'PENDING') return;
    await tx.mpOrder.update({
      where: { id: orderId },
      data: { status, mpStatus, mpStatusDetail: detail, lastSyncedAt: deps.now() },
    });
    await tx.payment.updateMany({
      where: { id: order.paymentId, status: 'PENDING' },
      data: { status: status === 'REJECTED' ? 'REJECTED' : status === 'EXPIRED' ? 'EXPIRED' : 'CANCELED' },
    });
  });
}

/**
 * Aplica a nuestra base lo que dice Mercado Pago de la orden. Es idempotente: se puede llamar
 * mil veces (webhook, sondeo, pantalla) y el resultado es el mismo.
 * El cobro aprobado lo confirma `applyApprovedOrder` en el worker, con la venta bloqueada.
 */
export async function applyOrderUpdate(
  deps: CoreDeps,
  orderId: string,
  remote: MpOrderApiDto,
): Promise<void> {
  const status = mapOrderStatus(remote.status);
  const paymentRef = remote.transactions?.payments?.[0];
  // Solo se guardan los datos crudos: el estado final lo escribe quien cierra la orden, para que
  // el cobro (Payment) se actualice siempre junto con ella.
  await deps.db.mpOrder.update({
    where: { id: orderId },
    data: {
      mpStatus: remote.status,
      mpStatusDetail: remote.status_detail ?? null,
      externalPaymentId: paymentRef?.id ?? null,
      externalPaymentRef: paymentRef?.reference_id ?? null,
      paidAmountCents: paymentRef?.amount ? BigInt(Math.round(Number(paymentRef.amount) * 100)) : null,
      lastPayload: remote as unknown as Prisma.InputJsonValue,
      lastSyncedAt: deps.now(),
    },
  });
  if (status === 'REJECTED' || status === 'CANCELED' || status === 'EXPIRED') {
    await closeOrderAsFailed(deps, orderId, status, remote.status, remote.status_detail ?? null);
  } else if (status === 'REFUNDED') {
    await deps.db.mpOrder.update({ where: { id: orderId }, data: { status: 'REFUNDED' } });
  }
}

/**
 * Aprueba el cobro de una orden Point y, si con eso la venta queda cubierta, la cierra
 * (comisiones, stock, turno atendido). Todo en una transacción y con la venta bloqueada.
 */
export async function applyApprovedOrder(deps: CoreDeps, orderId: string): Promise<void> {
  const now = deps.now();
  await deps.db.$transaction(
    async (tx) => {
      const order = await tx.mpOrder.findUniqueOrThrow({ where: { id: orderId } });
      if (order.status === 'APPROVED') return;
      await lockSale(tx, order.saleId);

      await tx.mpOrder.update({ where: { id: orderId }, data: { status: 'APPROVED' } });
      const updated = await tx.payment.updateMany({
        where: { id: order.paymentId, status: 'PENDING' },
        data: {
          status: 'APPROVED',
          approvedAt: now,
          // Si la terminal cobró otro monto (propina en la terminal), manda lo que pagó el cliente.
          ...(order.paidAmountCents && order.paidAmountCents !== order.amountCents
            ? { amountCents: order.paidAmountCents }
            : {}),
        },
      });
      if (updated.count === 0) return;
      await settleSaleIfCovered(tx, {
        saleId: order.saleId,
        userId: order.createdById ?? '',
        now,
        config: deps.config,
      });
    },
    { maxWait: 5_000, timeout: 20_000 },
  );
}

/** Los cobros con Point de una venta (para la pantalla de cobro). */
export async function listSaleOrders(
  deps: CoreDeps,
  p: StaffPrincipal,
  saleId: string,
): Promise<MpOrderDto[]> {
  requirePermission(p, 'sales:charge');
  const rows = await deps.db.mpOrder.findMany({
    where: { saleId, account: { organizationId: p.organizationId } },
    include: orderInclude,
    orderBy: { createdAt: 'desc' },
  });
  return rows.map(toDto);
}
