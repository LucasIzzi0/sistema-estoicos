import type { NotificationType, Prisma } from '@estoicos/db';
import { EmailSendError } from '@estoicos/integrations';
import type { CoreDeps } from '../../deps';
import { Errors } from '../../errors';
import type { RenderedEmail } from './templates';

export interface AuthEmailInput {
  organizationId: string;
  type: NotificationType;
  to: string;
  customerId?: string;
  userId?: string;
  /** Clave única del envío (ej. "login-code:<authCodeId>"). */
  dedupeKey: string;
  email: RenderedEmail;
  /** Datos que se guardan en el registro. NUNCA el código ni el token. */
  logPayload?: Prisma.InputJsonValue;
}

/**
 * Envía un email de acceso de forma SINCRÓNICA (no pasa por la cola): así el login no depende
 * del worker. Queda registrado en `notifications` con su estado, sin el código ni el token.
 */
export async function sendAuthEmail(deps: CoreDeps, input: AuthEmailInput): Promise<void> {
  const notification = await deps.db.notification.create({
    data: {
      organizationId: input.organizationId,
      customerId: input.customerId ?? null,
      userId: input.userId ?? null,
      type: input.type,
      channel: 'EMAIL',
      status: 'SENDING',
      recipient: input.to,
      dedupeKey: input.dedupeKey,
      payload: input.logPayload ?? {},
      attempts: 1,
    },
  });

  try {
    const result = await deps.mailer.send({
      to: input.to,
      subject: input.email.subject,
      text: input.email.text,
      html: input.email.html,
      replyTo: deps.config.emailReplyTo,
      idempotencyKey: notification.id,
      tags: { notification_id: notification.id, type: input.type.toLowerCase() },
    });
    await deps.db.notification.update({
      where: { id: notification.id },
      data: { status: 'SENT', sentAt: deps.now(), providerMessageId: result.providerMessageId },
    });
  } catch (error) {
    const message = error instanceof EmailSendError ? error.message : String(error);
    await deps.db.notification.update({
      where: { id: notification.id },
      data: { status: 'FAILED', failedAt: deps.now(), lastError: message.slice(0, 500) },
    });
    deps.log.error(
      { err: message, notificationId: notification.id, type: input.type },
      'Falló el envío de un email de acceso',
    );
    throw Errors.emailUnavailable();
  }
}
