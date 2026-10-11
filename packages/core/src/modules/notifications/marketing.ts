import { hmacSha256Hex } from '@estoicos/integrations';
import type { CoreDeps } from '../../deps';
import type { ReactivationPayload, ReviewPayload } from './messages';
import { queueNotification, stopMarketing } from './outbox';

/**
 * Mensajes de marketing (activados el 28/09/2026): pedido de reseña en Google y reactivación
 * del cliente que no vuelve. Los dos exigen consentimiento de marketing y respetan la franja
 * sin mensajes (21 a 9 h), que aplica el router.
 */

/** Link para darse de baja sin tener que iniciar sesión. */
export function unsubscribeUrl(deps: CoreDeps, customerId: string): string {
  const token = hmacSha256Hex(`unsubscribe:${customerId}`, deps.config.authCodeSecret).slice(0, 32);
  return `${deps.config.appPublicUrl}/baja?c=${customerId}&t=${token}`;
}

export function verifyUnsubscribeToken(deps: CoreDeps, customerId: string, token: string): boolean {
  return hmacSha256Hex(`unsubscribe:${customerId}`, deps.config.authCodeSecret).slice(0, 32) === token;
}

/** Baja de marketing desde el link del email. */
export async function unsubscribeByToken(
  deps: CoreDeps,
  customerId: string,
  token: string,
): Promise<boolean> {
  if (!verifyUnsubscribeToken(deps, customerId, token)) return false;
  const customer = await deps.db.customer.findUnique({ where: { id: customerId }, select: { id: true } });
  if (!customer) return false;
  await stopMarketing(deps, customerId, 'EMAIL_LINK');
  return true;
}

/**
 * Ventas cobradas hace más de N minutos que todavía no pidieron reseña. Se respeta el
 * enfriamiento por cliente (90 días por defecto): no se le pide dos veces seguidas.
 */
export async function dueReviewRequests(deps: CoreDeps, limit = 100) {
  const settings = await deps.db.organizationSettings.findFirst();
  const delayMinutes = settings?.reviewRequestDelayMinutes ?? 120;
  const cooldownDays = settings?.reviewRequestCooldownDays ?? 90;
  const now = deps.now();
  const until = new Date(now.getTime() - delayMinutes * 60_000);
  // No se busca más atrás de un día: lo viejo ya perdió sentido.
  const from = new Date(now.getTime() - 24 * 3600_000);

  const sales = await deps.db.sale.findMany({
    where: {
      status: 'PAID',
      paidAt: { gte: from, lte: until },
      customerId: { not: null },
      notifications: { none: { type: 'REVIEW_REQUEST' } },
    },
    select: { id: true, customerId: true, branchId: true, organizationId: true },
    take: limit,
  });

  const cooldown = new Date(now.getTime() - cooldownDays * 86_400_000);
  const eligible: typeof sales = [];
  for (const sale of sales) {
    const recent = await deps.db.notification.count({
      where: { customerId: sale.customerId, type: 'REVIEW_REQUEST', createdAt: { gte: cooldown } },
    });
    if (recent === 0) eligible.push(sale);
  }
  return eligible;
}

/** Encola el pedido de reseña de una venta. */
export async function queueReviewRequest(deps: CoreDeps, saleId: string): Promise<string | null> {
  return deps.db.$transaction(async (tx) => {
    const sale = await tx.sale.findUniqueOrThrow({
      where: { id: saleId },
      include: {
        organization: { select: { name: true } },
        branch: { select: { name: true, googleReviewUrl: true } },
        customer: { select: { id: true, firstName: true } },
        items: { where: { type: 'SERVICE' }, include: { barber: { select: { displayName: true } } } },
      },
    });
    if (!sale.customer) return null;
    const payload: ReviewPayload = {
      orgName: sale.organization.name,
      customerFirstName: sale.customer.firstName || 'cliente',
      branchName: sale.branch.name,
      barberName: sale.items[0]?.barber?.displayName ?? '',
      reviewUrl: sale.branch.googleReviewUrl,
      unsubscribeUrl: unsubscribeUrl(deps, sale.customer.id),
    };
    return queueNotification(tx, deps.config, {
      type: 'REVIEW_REQUEST',
      dedupeKey: `review:${sale.id}`,
      customerId: sale.customer.id,
      organizationId: sale.organizationId,
      branchId: sale.branchId,
      saleId: sale.id,
      payload,
      now: deps.now(),
    });
  });
}

/**
 * Clientes que no vuelven hace N semanas (5 por defecto). La clave anti-duplicado incluye su
 * última visita, así que solo se le escribe una vez por ausencia, y con un enfriamiento.
 */
export async function dueReactivations(deps: CoreDeps, limit = 100) {
  const settings = await deps.db.organizationSettings.findFirst();
  const afterDays = settings?.reactivationAfterDays ?? 35;
  const cooldownDays = settings?.reactivationCooldownDays ?? 30;
  const now = deps.now();
  const cutoff = new Date(now.getTime() - afterDays * 86_400_000);
  // Tampoco se persigue a quien no viene hace años.
  const floor = new Date(now.getTime() - 365 * 86_400_000);

  const customers = await deps.db.customer.findMany({
    where: {
      anonymizedAt: null,
      mergedIntoId: null,
      lastVisitAt: { lte: cutoff, gte: floor },
      bookingBlockedAt: null,
      consents: { some: { scope: 'MARKETING', granted: true } },
    },
    select: { id: true, firstName: true, lastVisitAt: true, organizationId: true, homeBranchId: true },
    take: limit,
  });

  const cooldown = new Date(now.getTime() - cooldownDays * 86_400_000);
  const eligible: typeof customers = [];
  for (const customer of customers) {
    const recent = await deps.db.notification.count({
      where: { customerId: customer.id, type: 'REACTIVATION', createdAt: { gte: cooldown } },
    });
    // Si tiene un turno futuro, no hace falta llamarlo.
    const upcoming = await deps.db.appointment.count({
      where: { customerId: customer.id, status: { in: ['BOOKED', 'CONFIRMED'] }, startsAt: { gt: now } },
    });
    if (recent === 0 && upcoming === 0) eligible.push(customer);
  }
  return eligible;
}

export async function queueReactivation(deps: CoreDeps, customerId: string): Promise<string | null> {
  return deps.db.$transaction(async (tx) => {
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      include: {
        organization: { select: { name: true } },
        homeBranch: { select: { name: true, slug: true } },
      },
    });
    if (!customer.lastVisitAt) return null;
    const branch =
      customer.homeBranch ??
      (await tx.branch.findFirstOrThrow({
        where: { organizationId: customer.organizationId, active: true },
        select: { name: true, slug: true },
      }));
    const weeks = Math.floor((deps.now().getTime() - customer.lastVisitAt.getTime()) / (7 * 86_400_000));
    const payload: ReactivationPayload = {
      orgName: customer.organization.name,
      customerFirstName: customer.firstName || 'cliente',
      branchName: branch.name,
      branchSlug: branch.slug,
      weeksAway: weeks,
      bookingUrl: `${deps.config.appPublicUrl}/reservar/${branch.slug}`,
      unsubscribeUrl: unsubscribeUrl(deps, customer.id),
    };
    return queueNotification(tx, deps.config, {
      type: 'REACTIVATION',
      dedupeKey: `reactivation:${customer.id}:${customer.lastVisitAt.toISOString().slice(0, 10)}`,
      customerId: customer.id,
      organizationId: customer.organizationId,
      branchId: customer.homeBranchId,
      payload,
      now: deps.now(),
    });
  });
}
