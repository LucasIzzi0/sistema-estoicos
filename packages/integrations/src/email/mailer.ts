/**
 * Envío de emails. `ResendMailer` en staging y producción; `ConsoleMailer` en desarrollo
 * (muestra el email en la consola); `MemoryMailer` en tests.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Resend no reenvía dos veces el mismo mensaje con la misma clave (24 h). */
  idempotencyKey?: string;
  /** Etiquetas que vuelven en los webhooks de Resend (ej. notification_id). */
  tags?: Record<string, string>;
}

export interface SendResult {
  providerMessageId: string;
}

export interface Mailer {
  readonly name: string;
  send(message: EmailMessage): Promise<SendResult>;
}

export class EmailSendError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryable = true,
  ) {
    super(message);
    this.name = 'EmailSendError';
  }
}

export class ResendMailer implements Mailer {
  readonly name = 'resend';

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly timeoutMs = 10_000,
  ) {}

  async send(message: EmailMessage): Promise<SendResult> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    };
    if (message.idempotencyKey) headers['Idempotency-Key'] = message.idempotencyKey;

    let response: Response;
    try {
      response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
          reply_to: message.replyTo,
          tags: message.tags
            ? Object.entries(message.tags).map(([name, value]) => ({ name, value }))
            : undefined,
        }),
      });
    } catch (error) {
      throw new EmailSendError(`No se pudo contactar a Resend: ${(error as Error).message}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const retryable = response.status === 429 || response.status >= 500;
      throw new EmailSendError(
        `Resend respondió ${response.status}: ${body.slice(0, 300)}`,
        response.status,
        retryable,
      );
    }
    const data = (await response.json()) as { id?: string };
    if (!data.id) throw new EmailSendError('Resend no devolvió el id del mensaje');
    return { providerMessageId: data.id };
  }
}

export class ConsoleMailer implements Mailer {
  readonly name = 'console';
  private counter = 0;

  constructor(private readonly log: (text: string) => void = (text) => console.info(text)) {}

  async send(message: EmailMessage): Promise<SendResult> {
    this.counter += 1;
    this.log(
      [
        '──────── EMAIL (desarrollo: no se envía) ────────',
        `Para: ${message.to}`,
        `Asunto: ${message.subject}`,
        '',
        message.text,
        '─────────────────────────────────────────────────',
      ].join('\n'),
    );
    return { providerMessageId: `console-${this.counter}` };
  }
}

export class MemoryMailer implements Mailer {
  readonly name = 'memory';
  readonly sent: EmailMessage[] = [];
  failNext: EmailSendError | null = null;

  async send(message: EmailMessage): Promise<SendResult> {
    if (this.failNext) {
      const error = this.failNext;
      this.failNext = null;
      throw error;
    }
    this.sent.push(message);
    return { providerMessageId: `memory-${this.sent.length}` };
  }

  last(): EmailMessage | undefined {
    return this.sent.at(-1);
  }
}
