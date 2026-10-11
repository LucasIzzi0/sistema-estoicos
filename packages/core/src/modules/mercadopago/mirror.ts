import type { MpAccount, Prisma } from '@estoicos/db';
import { MercadoPagoError, type MpPaymentDto as MpPaymentApiDto } from '@estoicos/integrations';
import type { CoreDeps } from '../../deps';
import { clearAccountError, markAccountError, mpClientFor } from './account';

/**
 * Espejo local de los pagos de la cuenta de Mercado Pago. Vive aparte del procesamiento de
 * órdenes para que tanto el worker (webhooks) como la pantalla de cobro puedan usarlo sin
 * dependencias cruzadas.
 */
const money = (value: number | null | undefined) =>
  value === null || value === undefined ? null : BigInt(Math.round(value * 100));

async function accountByMpUserId(deps: CoreDeps, mpUserId: string | null): Promise<MpAccount | null> {
  if (mpUserId) return deps.db.mpAccount.findUnique({ where: { mpUserId } });
  return deps.db.mpAccount.findFirst({ where: { status: 'ACTIVE' } });
}

/** Trae un pago de Mercado Pago y lo guarda en el espejo local. */
export async function syncPaymentById(
  deps: CoreDeps,
  mpUserId: string | null,
  paymentId: string,
  source: 'WEBHOOK' | 'SYNC_JOB' | 'ORDER_FETCH',
): Promise<string> {
  const account = await accountByMpUserId(deps, mpUserId);
  if (!account || account.status === 'DISCONNECTED') return 'cuenta desconocida';
  let remote: MpPaymentApiDto;
  try {
    remote = await mpClientFor(deps, account).getPayment(paymentId);
    await clearAccountError(deps, account);
  } catch (error) {
    if (error instanceof MercadoPagoError && error.status === 404) return 'pago inexistente';
    if (error instanceof MercadoPagoError && error.invalidToken)
      await markAccountError(deps, account.id, error.message);
    throw error;
  }
  await upsertMpPayment(deps, account, remote, source);
  return `pago ${remote.status}`;
}

/**
 * Guarda (o actualiza) el espejo del pago y lo concilia solo cuando se puede:
 * si su `external_reference` es nuestra, o si es el pago de una orden Point nuestra.
 * El resto queda en la bandeja "Pagos sin asignar".
 */
export async function upsertMpPayment(
  deps: CoreDeps,
  account: MpAccount,
  remote: MpPaymentApiDto,
  source: 'WEBHOOK' | 'SYNC_JOB' | 'ORDER_FETCH',
): Promise<void> {
  const externalId = String(remote.id);
  const reference = remote.external_reference ?? null;
  const terminalRef = remote.point_of_interaction?.transaction_data?.terminal_id ?? null;
  const orderRef = remote.order?.id ? String(remote.order.id) : null;
  const refunded = (remote.refunds ?? []).reduce((a, r) => a + r.amount, 0);

  // Sucursal: por la terminal que cobró, o por la caja/local de MP asignados a la sucursal.
  const terminal = terminalRef
    ? await deps.db.mpTerminal.findFirst({ where: { mpAccountId: account.id, externalId: terminalRef } })
    : null;
  const branchByStore = remote.store_id
    ? await deps.db.branch.findFirst({
        where: { organizationId: account.organizationId, mpStoreId: remote.store_id },
      })
    : null;

  const existing = await deps.db.mpPayment.findUnique({ where: { externalId } });
  const linkedOrder = orderRef ? await deps.db.mpOrder.findUnique({ where: { externalId: orderRef } }) : null;
  const byReference = reference ? await matchByReference(deps, account.organizationId, reference) : null;

  const rejected = !['approved', 'authorized', 'in_process', 'refunded', 'charged_back'].includes(
    remote.status,
  );
  const tooOld = new Date(remote.date_created) < account.reconcileFrom;
  const reconciliation = existing?.reconciliationStatus
    ? existing.reconciliationStatus
    : rejected || tooOld
      ? 'NOT_APPLICABLE'
      : linkedOrder || byReference
        ? 'AUTO_MATCHED'
        : 'UNASSIGNED';

  const data = {
    organizationId: account.organizationId,
    mpAccountId: account.id,
    externalId,
    status: remote.status,
    statusDetail: remote.status_detail ?? null,
    amountCents: BigInt(Math.round(remote.transaction_amount * 100)),
    netReceivedCents: money(remote.transaction_details?.net_received_amount),
    feeCents: money((remote.fee_details ?? []).reduce((a, f) => a + f.amount, 0)),
    refundedCents: BigInt(Math.round(refunded * 100)),
    currencyId: remote.currency_id,
    paymentMethodId: remote.payment_method_id ?? null,
    paymentTypeId: remote.payment_type_id ?? null,
    operationType: remote.operation_type ?? null,
    externalReference: reference,
    description: remote.description ?? null,
    payerEmail: remote.payer?.email ?? null,
    payerName: [remote.payer?.first_name, remote.payer?.last_name].filter(Boolean).join(' ') || null,
    payerDocNumber: remote.payer?.identification?.number ?? null,
    pointOfInteractionType: remote.point_of_interaction?.type ?? null,
    mpOrderRef: orderRef,
    mpTerminalRef: terminalRef,
    mpStoreRef: remote.store_id ?? null,
    mpPosRef: remote.pos_id === null || remote.pos_id === undefined ? null : String(remote.pos_id),
    branchId: terminal?.branchId ?? branchByStore?.id ?? linkedOrder?.branchId ?? existing?.branchId ?? null,
    dateCreated: new Date(remote.date_created),
    dateApproved: remote.date_approved ? new Date(remote.date_approved) : null,
    dateLastUpdated: new Date(remote.date_last_updated),
    moneyReleaseDate: remote.money_release_date ? new Date(remote.money_release_date) : null,
    raw: remote as unknown as Prisma.InputJsonValue,
    reconciliationStatus: reconciliation,
  };

  const saved = await deps.db.mpPayment.upsert({
    where: { externalId },
    create: { ...data, firstSeenVia: source },
    update: data,
  });

  // El cobro nuestro queda atado al pago de MP (UNIQUE: no se puede usar dos veces).
  const ourPaymentId = linkedOrder?.paymentId ?? byReference?.paymentId ?? null;
  if (ourPaymentId) {
    await deps.db.payment
      .updateMany({ where: { id: ourPaymentId, mpPaymentId: null }, data: { mpPaymentId: saved.id } })
      .catch(() => undefined);
  }
}

/** Nuestras referencias: `sale_<id>_<intento>` (Point) y `dep_<idCobro>` (seña online). */
async function matchByReference(
  deps: CoreDeps,
  organizationId: string,
  reference: string,
): Promise<{ paymentId: string } | null> {
  if (reference.startsWith('sale_')) {
    const order = await deps.db.mpOrder.findUnique({ where: { externalReference: reference } });
    return order ? { paymentId: order.paymentId } : null;
  }
  if (reference.startsWith('dep_')) {
    const paymentId = reference.slice(4);
    const payment = await deps.db.payment.findFirst({ where: { id: paymentId, organizationId } });
    return payment ? { paymentId: payment.id } : null;
  }
  return null;
}

/**
 * Sincronización periódica de pagos (cada 10 min). Se piden por fecha de última actualización
 * con 15 minutos de solapamiento, en páginas chicas: la paginación de MP tiene tope de 10.000.
 */
export async function syncAccountPayments(
  deps: CoreDeps,
  accountId: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<{ fetched: number }> {
  const account = await deps.db.mpAccount.findUniqueOrThrow({ where: { id: accountId } });
  if (account.status === 'DISCONNECTED') return { fetched: 0 };
  const now = deps.now();
  const from = new Date(
    Math.max(
      (account.paymentsSyncedUntil ?? account.reconcileFrom).getTime() - 15 * 60_000,
      account.reconcileFrom.getTime() - 15 * 60_000,
    ),
  );
  const client = mpClientFor(deps, account);
  const pageSize = options.pageSize ?? 50;
  let offset = 0;
  let fetched = 0;

  for (let page = 0; page < (options.maxPages ?? 20); page += 1) {
    let batch;
    try {
      batch = await client.searchPayments({ from, to: now, offset, limit: pageSize });
      await clearAccountError(deps, account);
    } catch (error) {
      const message = error instanceof MercadoPagoError ? error.message : String(error);
      if (error instanceof MercadoPagoError && error.invalidToken)
        await markAccountError(deps, account.id, message);
      throw error;
    }
    for (const payment of batch.results) await upsertMpPayment(deps, account, payment, 'SYNC_JOB');
    fetched += batch.results.length;
    offset += batch.results.length;
    if (batch.results.length < pageSize || offset >= batch.total) break;
  }

  await deps.db.mpAccount.update({ where: { id: accountId }, data: { paymentsSyncedUntil: now } });
  return { fetched };
}

/** Cuentas activas (las recorre el job de sincronización). */
export async function activeMpAccounts(deps: CoreDeps) {
  return deps.db.mpAccount.findMany({ where: { status: 'ACTIVE' }, select: { id: true } });
}
