import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * WhatsApp Cloud API (Meta). Solo se pueden iniciar conversaciones con **plantillas aprobadas**;
 * por eso cada tipo de mensaje tiene su plantilla configurada en `notification_type_settings`.
 * Sin plantilla, ese mensaje sale por email.
 */
export interface WhatsAppTemplateMessage {
  /** Teléfono en E.164 sin el "+" (lo que espera Meta). */
  to: string;
  templateName: string;
  languageCode: string;
  /** Variables del cuerpo, en orden. */
  bodyParams: string[];
  /** Texto de los botones de respuesta rápida (payload de cada uno). */
  buttonPayloads?: string[];
}

export interface WhatsAppSendResult {
  /** Id del mensaje en Meta (wamid…), para correlacionar los webhooks de estado. */
  messageId: string;
  /** Identificador de usuario por empresa: desde 2026 Meta puede omitir el número. */
  userId?: string | undefined;
}

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Código de error de Meta: 131026 = el número no tiene WhatsApp; 131050 = frenó el marketing. */
    readonly code?: number,
    readonly retryable = false,
  ) {
    super(message);
    this.name = 'WhatsAppError';
  }

  /** El número no tiene WhatsApp: se marca el cliente y se pasa a email. */
  get unreachable(): boolean {
    return this.code === 131026 || this.code === 131047;
  }

  /** El usuario frenó los mensajes de marketing de esta empresa. */
  get marketingStopped(): boolean {
    return this.code === 131050;
  }
}

export interface WhatsApp {
  readonly name: string;
  sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult>;
}

export class CloudApiWhatsApp implements WhatsApp {
  readonly name = 'whatsapp';

  constructor(
    private readonly config: { phoneNumberId: string; accessToken: string },
    private readonly options: { baseUrl?: string; fetch?: typeof fetch; timeoutMs?: number } = {},
  ) {}

  async sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    const url = `${this.options.baseUrl ?? 'https://graph.facebook.com/v23.0'}/${this.config.phoneNumberId}/messages`;
    const components: unknown[] = [
      {
        type: 'body',
        parameters: message.bodyParams.map((text) => ({ type: 'text', text })),
      },
    ];
    (message.buttonPayloads ?? []).forEach((payload, index) => {
      components.push({
        type: 'button',
        sub_type: 'quick_reply',
        index: String(index),
        parameters: [{ type: 'payload', payload }],
      });
    });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 15_000);
    let response: Response;
    try {
      response = await (this.options.fetch ?? fetch)(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: message.to,
          type: 'template',
          template: {
            name: message.templateName,
            language: { code: message.languageCode },
            components,
          },
        }),
        signal: controller.signal,
      });
    } catch (error) {
      throw new WhatsAppError(
        `No se pudo hablar con WhatsApp: ${error instanceof Error ? error.message : String(error)}`,
        0,
        undefined,
        true,
      );
    } finally {
      clearTimeout(timer);
    }

    const payload = (await response.json().catch(() => ({}))) as {
      messages?: { id: string }[];
      contacts?: { wa_id?: string; user_id?: string }[];
      error?: { message?: string; code?: number };
    };
    if (!response.ok) {
      throw new WhatsAppError(
        payload.error?.message ?? `WhatsApp respondió ${response.status}`,
        response.status,
        payload.error?.code,
        response.status >= 500 || response.status === 429,
      );
    }
    return {
      messageId: payload.messages?.[0]?.id ?? '',
      userId: payload.contacts?.[0]?.user_id ?? payload.contacts?.[0]?.wa_id,
    };
  }
}

/**
 * Firma de los webhooks de Meta: `X-Hub-Signature-256: sha256=<hmac del cuerpo crudo>`.
 * Se compara en tiempo constante y **sobre el cuerpo tal cual llegó** (no sobre el JSON
 * reserializado, que puede diferir en espacios o en el orden de las claves).
 */
export function verifyMetaSignature(input: {
  rawBody: string | Buffer;
  header: string | undefined;
  appSecret: string;
}): boolean {
  if (!input.header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', input.appSecret).update(input.rawBody).digest('hex');
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(input.header.slice('sha256='.length), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
