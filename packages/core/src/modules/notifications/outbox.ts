import type { NotificationChannel, NotificationType, Prisma, Tx } from '@estoicos/db';
import { EmailSendError, WhatsAppError } from '@estoicos/integrations';
import { instantToLocal, DEFAULT_TIMEZONE } from '@estoicos/shared';
import type { CoreConfig, CoreDeps } from '../../deps';
import { renderNotificationEmail, whatsappParamsFor, type NotificationPayload } from './messages';
import { chooseChannel, fallbackChannel, loadRecipient, type RecipientState } from './router';

/**
 * Bandeja de salida (outbox). La lógica de negocio pide "avisale al cliente X del hecho Y" y
 * se crea la fila en `notifications` DENTRO de la misma transacción del hecho; el worker la
 * envía después. Si algo se cae entre medio, el despachador periódico la retoma.
 *
 * El **router** decide el canal (WhatsApp o email) según preferencia, consentimiento y
 * disponibilidad. Si WhatsApp falla, se crea automáticamente el envío por email apuntando al
 * fallido. `dedupeKey` UNIQUE impide mandar dos veces el mismo mensaje.
 */
export const MAX_SEND_ATTEMPTS = 5;

export interface QueueInput {
  type: NotificationType;
  dedupeKey: string;
  customerId: string;
  organizationId: string;
  branchId?: string | null;
  appointmentId?: string | null;
  saleId?: string | null;
  payload: NotificationPayload;
  /** Cuándo mandarlo (los recordatorios se programan a futuro). */
  scheduledFor?: Date;
  /** Ahora, según el reloj de la app (inyectable: los tests lo fijan). */
  now?: Date;
}

/** Disponibilidad de canales de la organización, con la plantilla de WhatsApp de ese tipo. */
async function availabilityFor(tx: Tx, organizationId: string, type: NotificationType, when: Date) {
  const [settings, typeSetting] = await Promise.all([
    tx.organizationSettings.findUnique({ where: { organizationId } }),
    tx.notificationTypeSetting.findUnique({ where: { organizationId_type: { organizationId, type } } }),
  ]);
  return {
    enabled: typeSetting?.enabled ?? true,
    whatsappEnabled: settings?.whatsappEnabled ?? false,
    whatsappTemplate: typeSetting?.whatsappTemplateName ?? null,
    whatsappLanguage: typeSetting?.whatsappTemplateLanguage ?? 'es_AR',
    quiet: {
      startMinute: settings?.marketingQuietStartMinute ?? 1260,
      endMinute: settings?.marketingQuietEndMinute ?? 540,
    },
    nowMinute: instantToLocal(when, DEFAULT_TIMEZONE).minute,
  };
}

/**
 * Encola un mensaje. Devuelve el id a despachar, o null si no hay nada que mandar (repetido,
 * tipo apagado, o el cliente no lo acepta: eso queda registrado como "omitido" con el motivo).
 */
export async function queueNotification(
  tx: Tx,
  config: CoreConfig,
  input: QueueInput,
): Promise<string | null> {
  if (await tx.notification.findUnique({ where: { dedupeKey: input.dedupeKey }, select: { id: true } })) {
    return null;
  }
  const recipient = await loadRecipient(tx, input.customerId);
  if (!recipient) return null;

  const when = input.scheduledFor ?? input.now ?? new Date();
  const availability = await availabilityFor(tx, input.organizationId, input.type, when);
  if (!availability.enabled) return null;

  const decision = chooseChannel(input.type, recipient, availability);
  const common = {
    organizationId: input.organizationId,
    branchId: input.branchId ?? null,
    customerId: input.customerId,
    appointmentId: input.appointmentId ?? null,
    saleId: input.saleId ?? null,
    type: input.type,
    dedupeKey: input.dedupeKey,
    payload: { ...input.payload, appPublicUrl: config.appPublicUrl } as unknown as Prisma.InputJsonValue,
    scheduledFor: when,
  };

  if (!decision.send) {
    await tx.notification.create({
      data: {
        ...common,
        channel: recipient.preferredChannel,
        status: 'SKIPPED',
        skippedReason: decision.reason,
        recipient: recipient.email ?? recipient.phone ?? '',
      },
    });
    return null;
  }

  const notification = await tx.notification.create({
    data: {
      ...common,
      channel: decision.channel,
      status: 'PENDING',
      templateName: decision.templateName,
      recipient: decision.channel === 'WHATSAPP' ? recipient.phone! : recipient.email!,
    },
  });
  return notification.id;
}

/** Avisa al worker (sin frenar el pedido: el despachador periódico es el respaldo). */
export async function dispatchQueued(deps: CoreDeps, ids: (string | null)[]): Promise<void> {
  const pending = ids.filter((id): id is string => !!id);
  if (!pending.length || !deps.dispatchNotifications) return;
  try {
    await deps.dispatchNotifications(pending);
  } catch (error) {
    deps.log.warn({ err: String(error), ids: pending }, 'No se pudo encolar; lo retoma el despachador');
  }
}

/**
 * Envía UNA notificación. El paso PENDING → SENDING es atómico (UPDATE … WHERE status =
 * 'PENDING'): si dos procesos la toman a la vez, solo uno la manda.
 * Si WhatsApp falla, se crea el envío por email apuntando al fallido (fallback).
 */
export async function sendNotification(
  deps: CoreDeps,
  id: string,
): Promise<'SENT' | 'RETRY' | 'FAILED' | 'NOOP' | 'FELL_BACK'> {
  const now = deps.now();
  const claimed = await deps.db.notification.updateMany({
    where: { id, status: 'PENDING', scheduledFor: { lte: now } },
    data: { status: 'SENDING', attempts: { increment: 1 } },
  });
  if (claimed.count === 0) return 'NOOP';
  const n = await deps.db.notification.findUniqueOrThrow({ where: { id } });

  try {
    const result = n.channel === 'WHATSAPP' ? await sendByWhatsApp(deps, n) : await sendByEmail(deps, n);
    await deps.db.notification.update({
      where: { id },
      data: {
        status: 'SENT',
        sentAt: deps.now(),
        providerMessageId: result.providerMessageId,
        lastError: null,
      },
    });
    if (result.whatsappUserId && n.customerId) {
      // Desde 2026 Meta puede omitir el número en los webhooks: se guarda su id de usuario.
      await deps.db.customer
        .updateMany({
          where: { id: n.customerId, whatsappUserId: null },
          data: { whatsappUserId: result.whatsappUserId },
        })
        .catch(() => undefined);
    }
    return 'SENT';
  } catch (error) {
    return handleSendFailure(deps, n.id, error);
  }
}

async function sendByEmail(
  deps: CoreDeps,
  n: { id: string; type: NotificationType; recipient: string; payload: unknown },
) {
  const email = renderNotificationEmail(n.type, n.payload as NotificationPayload);
  if (!email) throw new EmailSendError(`Tipo sin plantilla de email: ${n.type}`, undefined, false);
  const result = await deps.mailer.send({
    to: n.recipient,
    subject: email.subject,
    text: email.text,
    html: email.html,
    replyTo: deps.config.emailReplyTo,
    idempotencyKey: n.id,
    tags: { notification_id: n.id, type: n.type.toLowerCase() },
  });
  return { providerMessageId: result.providerMessageId, whatsappUserId: undefined as string | undefined };
}

async function sendByWhatsApp(
  deps: CoreDeps,
  n: { id: string; type: NotificationType; recipient: string; templateName: string | null; payload: unknown },
) {
  if (!deps.whatsapp) throw new WhatsAppError('WhatsApp no está configurado', 0, undefined, false);
  if (!n.templateName)
    throw new WhatsAppError('Sin plantilla aprobada para este mensaje', 0, undefined, false);
  const params = whatsappParamsFor(n.type, n.payload as NotificationPayload);
  const setting = await deps.db.notificationTypeSetting.findFirst({ where: { type: n.type } });
  const result = await deps.whatsapp.sendTemplate({
    // Meta espera el número sin el "+".
    to: n.recipient.replace(/^\+/, ''),
    templateName: n.templateName,
    languageCode: setting?.whatsappTemplateLanguage ?? 'es_AR',
    bodyParams: params.body,
    buttonPayloads: params.buttons,
  });
  return { providerMessageId: result.messageId, whatsappUserId: result.userId };
}

/**
 * Qué hacer cuando un envío falla: marcar el número como sin WhatsApp, registrar la baja de
 * marketing, caer a email, reintentar con espera creciente o darlo por perdido.
 */
async function handleSendFailure(
  deps: CoreDeps,
  id: string,
  error: unknown,
): Promise<'RETRY' | 'FAILED' | 'FELL_BACK'> {
  const n = await deps.db.notification.findUniqueOrThrow({ where: { id } });
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const now = deps.now();

  if (error instanceof WhatsAppError && n.customerId) {
    // El número no tiene WhatsApp: no se vuelve a intentar por ahí hasta que lo cambien.
    if (error.unreachable) {
      await deps.db.customer.update({ where: { id: n.customerId }, data: { whatsappUnreachableAt: now } });
    }
    // El cliente frenó el marketing: se registra la baja con su evidencia.
    if (error.marketingStopped) await stopMarketing(deps, n.customerId, 'WHATSAPP_REPLY');
  }

  const retryable =
    (error instanceof EmailSendError && error.retryable) ||
    (error instanceof WhatsAppError && error.retryable && !error.unreachable && !error.marketingStopped);

  // WhatsApp falló definitivamente: se rehace por email.
  if (n.channel === 'WHATSAPP' && !retryable && n.customerId) {
    const fallbackId = await createEmailFallback(deps, n.id);
    await deps.db.notification.update({
      where: { id },
      data: { status: 'FAILED', failedAt: now, lastError: message },
    });
    if (fallbackId) {
      await dispatchQueued(deps, [fallbackId]);
      deps.log.info({ notificationId: id, fallbackId }, 'WhatsApp falló: se manda por email');
      return 'FELL_BACK';
    }
    return 'FAILED';
  }

  const giveUp = !retryable || n.attempts >= MAX_SEND_ATTEMPTS;
  await deps.db.notification.update({
    where: { id },
    data: giveUp
      ? { status: 'FAILED', failedAt: now, lastError: message }
      : {
          status: 'PENDING',
          lastError: message,
          // 1, 4, 9, 16 minutos…
          scheduledFor: new Date(now.getTime() + n.attempts * n.attempts * 60_000),
        },
  });
  deps.log.warn(
    { notificationId: id, attempt: n.attempts, err: message },
    'Falló el envío de una notificación',
  );
  return giveUp ? 'FAILED' : 'RETRY';
}

/** Crea el envío por email de un mensaje de WhatsApp que falló. */
async function createEmailFallback(deps: CoreDeps, failedId: string): Promise<string | null> {
  return deps.db.$transaction(async (tx) => {
    const failed = await tx.notification.findUniqueOrThrow({ where: { id: failedId } });
    if (!failed.customerId) return null;
    const recipient = await loadRecipient(tx, failed.customerId);
    if (!recipient) return null;
    const fallback = fallbackChannel(failed.type, recipient);
    if (!fallback) return null;
    const created = await tx.notification.create({
      data: {
        organizationId: failed.organizationId,
        branchId: failed.branchId,
        customerId: failed.customerId,
        appointmentId: failed.appointmentId,
        saleId: failed.saleId,
        type: failed.type,
        channel: 'EMAIL',
        status: 'PENDING',
        recipient: recipient.email!,
        dedupeKey: `${failed.dedupeKey}:email`,
        payload: failed.payload as Prisma.InputJsonValue,
        fallbackOfId: failed.id,
      },
    });
    return created.id;
  });
}

/** Registra la baja de marketing con su evidencia (responder "BAJA", frenarlo en WhatsApp…). */
export async function stopMarketing(
  deps: CoreDeps,
  customerId: string,
  source: 'WHATSAPP_REPLY' | 'EMAIL_LINK',
): Promise<void> {
  const now = deps.now();
  await deps.db.$transaction(async (tx) => {
    for (const channel of ['WHATSAPP', 'EMAIL'] as const) {
      const current = await tx.customerConsent.findUnique({
        where: { customerId_channel_scope: { customerId, channel, scope: 'MARKETING' } },
      });
      if (current && !current.granted) continue;
      await tx.customerConsent.upsert({
        where: { customerId_channel_scope: { customerId, channel, scope: 'MARKETING' } },
        create: { customerId, channel, scope: 'MARKETING', granted: false },
        update: { granted: false },
      });
      await tx.consentEvent.create({
        data: {
          customerId,
          channel,
          scope: 'MARKETING',
          granted: false,
          source,
          policyVersion: 'baja-solicitada',
          occurredAt: now,
        },
      });
    }
  });
}

/**
 * Despachador periódico: devuelve las pendientes que ya tocan (con su número de intento, que
 * forma parte del id del job) y recupera las que quedaron "enviando" por un proceso caído.
 */
export async function findDueNotifications(
  deps: Pick<CoreDeps, 'db' | 'now'>,
  limit = 200,
): Promise<{ id: string; attempts: number }[]> {
  const now = deps.now();
  await deps.db.notification.updateMany({
    where: { status: 'SENDING', updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
    data: { status: 'PENDING' },
  });
  return deps.db.notification.findMany({
    where: { status: 'PENDING', scheduledFor: { lte: now } },
    select: { id: true, attempts: true },
    orderBy: { scheduledFor: 'asc' },
    take: limit,
  });
}

export type { NotificationChannel, RecipientState };
