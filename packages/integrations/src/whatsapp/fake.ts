import {
  WhatsAppError,
  type WhatsApp,
  type WhatsAppSendResult,
  type WhatsAppTemplateMessage,
} from './client';

/**
 * WhatsApp simulado: se usa en los tests y mientras no haya número aprobado en Meta.
 * Permite forzar los errores reales (número sin WhatsApp, marketing frenado, caída) para
 * probar el fallback a email.
 */
export class FakeWhatsApp implements WhatsApp {
  readonly name = 'whatsapp';
  readonly sent: (WhatsAppTemplateMessage & { messageId: string })[] = [];
  /** Números que "no tienen WhatsApp" (error 131026 de Meta). */
  readonly unreachable = new Set<string>();
  /** Números que frenaron el marketing (error 131050). */
  readonly marketingStopped = new Set<string>();
  /** La próxima llamada falla con este error. */
  failNext: WhatsAppError | null = null;
  private seq = 0;

  async sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    if (this.unreachable.has(message.to)) {
      throw new WhatsAppError('Recipient phone number not in allowed list', 400, 131026);
    }
    if (this.marketingStopped.has(message.to)) {
      throw new WhatsAppError('User stopped marketing messages', 400, 131050);
    }
    this.seq += 1;
    const messageId = `wamid.FAKE${String(this.seq).padStart(8, '0')}`;
    this.sent.push({ ...message, messageId });
    return { messageId, userId: `BSUID-${message.to}` };
  }

  last() {
    return this.sent.at(-1);
  }
}
