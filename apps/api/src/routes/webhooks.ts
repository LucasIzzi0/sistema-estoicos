import {
  raiseAlert,
  receiveMercadoPagoWebhook,
  receiveResendWebhook,
  receiveWhatsAppWebhook,
} from '@estoicos/core';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

/**
 * Webhooks de Mercado Pago. Reglas (docs/fase-0/01-arquitectura.md §9.4):
 * firma SIEMPRE, idempotencia por evento, respuesta 200 inmediata (MP da 22 s) y el trabajo
 * real en la cola. El cuerpo se acepta tal cual viene: nunca se confía en su contenido.
 */
export const webhookRoutes: FastifyPluginAsyncZod<{ ctx: AppContext }> = async (app, { ctx }) => {
  const { deps, config } = ctx;
  const webhook = { policy: { kind: 'webhook' }, rateLimit: { max: 600, timeWindow: '1 minute' } } as const;

  /** Alerta en el panel: puede ser un intento de fraude o una clave mal configurada. */
  const signatureAlert = (provider: string, ip: string | undefined) =>
    raiseAlert(
      deps.db,
      {
        kind: 'WEBHOOK_SIGNATURE_INVALID',
        severity: 'WARNING',
        dedupeKey: `webhook-signature:${provider}`,
        message: `Llegaron webhooks de ${provider} con firma inválida.`,
        details: { ip: ip ?? null },
      },
      deps.now(),
    );

  app.post(
    '/webhooks/mercadopago',
    {
      // Sin autenticación de sesión: la autenticidad la da la firma.
      config: webhook,
      schema: {
        body: z.record(z.string(), z.unknown()),
        querystring: z.object({
          'data.id': z.string().optional(),
          id: z.string().optional(),
          type: z.string().optional(),
        }),
        response: { 200: z.object({ received: z.boolean() }), 401: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const result = await receiveMercadoPagoWebhook(deps, {
        body: request.body,
        queryDataId: query['data.id'] ?? query.id,
        signatureHeader: request.headers['x-signature'] as string | undefined,
        requestId: request.headers['x-request-id'] as string | undefined,
      });

      switch (result.outcome) {
        case 'INVALID_SIGNATURE':
          // Se avisa en el panel: puede ser un intento de fraude o una clave mal configurada.
          await signatureAlert('Mercado Pago', request.meta.ip);
          request.log.warn({ ip: request.meta.ip }, 'Webhook de Mercado Pago con firma inválida');
          return reply.code(401).send({ error: 'firma inválida' });
        case 'UNKNOWN_ACCOUNT':
          request.log.warn('Webhook de Mercado Pago de una cuenta que no tenemos vinculada');
          return reply.code(200).send({ received: true });
        case 'QUEUED':
          // Se responde YA y el worker hace el trabajo (le pregunta a MP el estado real).
          await ctx.enqueueWebhook(result.eventId).catch((error: unknown) => {
            request.log.error({ err: String(error) }, 'No se pudo encolar el webhook; lo retoma el barrido');
          });
          return reply.code(200).send({ received: true });
        default:
          return reply.code(200).send({ received: true });
      }
    },
  );

  // --- WhatsApp (Meta) ---
  // Verificación del endpoint: Meta pide devolver el desafío cuando se configura el webhook.
  app.get(
    '/webhooks/whatsapp',
    {
      config: webhook,
      schema: {
        querystring: z.object({
          'hub.mode': z.string().optional(),
          'hub.verify_token': z.string().optional(),
          'hub.challenge': z.string().optional(),
        }),
        response: { 200: z.string(), 403: z.string() },
      },
    },
    async (request, reply) => {
      const query = request.query as Record<string, string | undefined>;
      const expected = config.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
      if (query['hub.mode'] === 'subscribe' && expected && query['hub.verify_token'] === expected) {
        return reply.type('text/plain').send(query['hub.challenge'] ?? '');
      }
      return reply.code(403).type('text/plain').send('forbidden');
    },
  );

  app.post(
    '/webhooks/whatsapp',
    {
      config: webhook,
      schema: {
        body: z.record(z.string(), z.unknown()),
        response: { 200: z.object({ received: z.boolean() }), 401: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const secret = config.env.WHATSAPP_APP_SECRET;
      if (!secret) {
        request.log.error('Webhook de WhatsApp sin WHATSAPP_APP_SECRET configurado');
        return reply.code(401).send({ error: 'sin configurar' });
      }
      const result = await receiveWhatsAppWebhook(deps, {
        rawBody: request.rawBody ?? JSON.stringify(request.body),
        body: request.body,
        signature: request.headers['x-hub-signature-256'] as string | undefined,
        appSecret: secret,
      });
      if (result.outcome === 'INVALID_SIGNATURE') {
        await signatureAlert('WhatsApp', request.meta.ip);
        return reply.code(401).send({ error: 'firma inválida' });
      }
      return reply.code(200).send({ received: true });
    },
  );

  // --- Resend (estado de los emails) ---
  app.post(
    '/webhooks/resend',
    {
      config: webhook,
      schema: {
        body: z.record(z.string(), z.unknown()),
        response: { 200: z.object({ received: z.boolean() }), 401: z.object({ error: z.string() }) },
      },
    },
    async (request, reply) => {
      const secret = config.env.RESEND_WEBHOOK_SECRET;
      if (!secret) {
        request.log.error('Webhook de Resend sin RESEND_WEBHOOK_SECRET configurado');
        return reply.code(401).send({ error: 'sin configurar' });
      }
      const result = await receiveResendWebhook(deps, {
        rawBody: request.rawBody ?? JSON.stringify(request.body),
        body: request.body,
        svixId: request.headers['svix-id'] as string | undefined,
        svixTimestamp: request.headers['svix-timestamp'] as string | undefined,
        svixSignature: request.headers['svix-signature'] as string | undefined,
        secret,
      });
      if (result.outcome === 'INVALID_SIGNATURE') {
        await signatureAlert('Resend', request.meta.ip);
        return reply.code(401).send({ error: 'firma inválida' });
      }
      return reply.code(200).send({ received: true });
    },
  );
};
