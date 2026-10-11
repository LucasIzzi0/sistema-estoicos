import type { Prisma } from '@estoicos/db';
import {
  notificationLogQuery,
  updateNotificationSettingsBody,
  updateNotificationTypeBody,
  type NotificationLogItem,
  type NotificationSettings,
  type NotificationType,
  type UpdateNotificationSettingsBody,
  type UpdateNotificationTypeBody,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors } from '../../errors';
import { writeAudit } from '../audit/audit';

/** Configuración de notificaciones y registro de envíos (pantalla "Notificaciones"). */
export async function getNotificationSettings(
  deps: CoreDeps,
  p: StaffPrincipal,
): Promise<NotificationSettings> {
  requirePermission(p, 'notifications:settings');
  const [settings, types] = await Promise.all([
    deps.db.organizationSettings.findUniqueOrThrow({ where: { organizationId: p.organizationId } }),
    deps.db.notificationTypeSetting.findMany({ where: { organizationId: p.organizationId } }),
  ]);
  return {
    whatsappEnabled: settings.whatsappEnabled,
    reminderOffsetsMinutes: settings.reminderOffsetsMinutes,
    marketingQuietStartMinute: settings.marketingQuietStartMinute,
    marketingQuietEndMinute: settings.marketingQuietEndMinute,
    reactivationAfterDays: settings.reactivationAfterDays,
    reviewRequestDelayMinutes: settings.reviewRequestDelayMinutes,
    types: types.map((t) => ({
      type: t.type,
      enabled: t.enabled,
      whatsappTemplateName: t.whatsappTemplateName,
      whatsappTemplateLanguage: t.whatsappTemplateLanguage,
    })),
    whatsappConfigured: !!deps.whatsapp,
  };
}

export async function updateNotificationSettings(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: UpdateNotificationSettingsBody,
  meta: RequestMeta,
): Promise<NotificationSettings> {
  requirePermission(p, 'notifications:settings');
  const body = updateNotificationSettingsBody.parse(rawBody);
  if (body.whatsappEnabled && !deps.whatsapp) {
    throw Errors.conflict('Todavía no está configurado el número de WhatsApp en el servidor.');
  }
  const before = await deps.db.organizationSettings.findUniqueOrThrow({
    where: { organizationId: p.organizationId },
  });
  await deps.db.$transaction(async (tx) => {
    await tx.organizationSettings.update({ where: { organizationId: p.organizationId }, data: body });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'SETTINGS_CHANGED',
      entityType: 'OrganizationSettings',
      entityId: p.organizationId,
      summary: 'Configuración de notificaciones',
      before: {
        whatsappEnabled: before.whatsappEnabled,
        reminderOffsetsMinutes: before.reminderOffsetsMinutes,
      },
      after: body as Prisma.InputJsonValue,
      meta,
    });
  });
  return getNotificationSettings(deps, p);
}

export async function updateNotificationType(
  deps: CoreDeps,
  p: StaffPrincipal,
  type: NotificationType,
  rawBody: UpdateNotificationTypeBody,
): Promise<NotificationSettings> {
  requirePermission(p, 'notifications:settings');
  const body = updateNotificationTypeBody.parse(rawBody);
  // Los mensajes de acceso (código de login, invitaciones) no se pueden apagar.
  const access = ['LOGIN_CODE', 'STAFF_INVITATION', 'STAFF_PASSWORD_RESET', 'STAFF_SECOND_FACTOR'];
  if (access.includes(type) && body.enabled === false) {
    throw Errors.invalid('Ese mensaje no se puede apagar: es la forma de entrar al sistema.');
  }
  await deps.db.notificationTypeSetting.upsert({
    where: { organizationId_type: { organizationId: p.organizationId, type } },
    create: { organizationId: p.organizationId, type, ...body },
    update: body,
  });
  return getNotificationSettings(deps, p);
}

export async function listNotifications(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawQuery: z.input<typeof notificationLogQuery>,
): Promise<NotificationLogItem[]> {
  requirePermission(p, 'notifications:settings');
  const query = notificationLogQuery.parse(rawQuery);
  const rows = await deps.db.notification.findMany({
    where: {
      organizationId: p.organizationId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
    },
    include: { customer: { select: { firstName: true, lastName: true } } },
    orderBy: { createdAt: 'desc' },
    take: query.limit,
  });
  return rows.map((n) => ({
    id: n.id,
    type: n.type,
    channel: n.channel,
    status: n.status,
    recipient: n.recipient,
    customerId: n.customerId,
    customerName: n.customer ? `${n.customer.firstName} ${n.customer.lastName}`.trim() : null,
    scheduledFor: n.scheduledFor.toISOString(),
    sentAt: n.sentAt?.toISOString() ?? null,
    deliveredAt: n.deliveredAt?.toISOString() ?? null,
    readAt: n.readAt?.toISOString() ?? null,
    failedAt: n.failedAt?.toISOString() ?? null,
    lastError: n.lastError,
    skippedReason: n.skippedReason,
    attempts: n.attempts,
    isFallback: !!n.fallbackOfId,
  }));
}
