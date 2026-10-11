import { safeEqual } from '@estoicos/integrations';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import type { ApiConfig } from '../config';
import './types';

/**
 * Primera línea de cada pedido:
 * - Contexto (IP real, request-id, user agent) para rate limits, sesiones y auditoría.
 * - Las rutas de negocio (/v1) solo se aceptan si vienen del proxy de la web con el secreto interno.
 *   Pedidas directo al dominio público, responden 404 (docs/fase-0/01-arquitectura.md §3).
 * - Los webhooks solo se aceptan si pasaron por Cloudflare (header secreto de origen).
 * - Las mutaciones con un Origin distinto al de la web se rechazan (CSRF).
 */
export const securityPlugin = fp(
  async (app: FastifyInstance, opts: { config: ApiConfig }) => {
    const { env, appOrigin } = opts.config;
    app.decorateRequest('meta', null as never);

    app.addHook('onRequest', async (request, reply) => {
      const path = request.url.split('?')[0] ?? '';
      const fromProxy =
        env.INTERNAL_API_SECRET !== undefined &&
        safeEqual(String(request.headers['x-internal-secret'] ?? ''), env.INTERNAL_API_SECRET);

      const forwardedIp = request.headers['x-client-ip'];
      request.meta = {
        ip: fromProxy && typeof forwardedIp === 'string' ? forwardedIp : request.ip,
        userAgent: request.headers['user-agent']?.slice(0, 400),
        requestId: request.id,
      };

      if (path.startsWith('/v1') && env.INTERNAL_API_SECRET !== undefined && !fromProxy) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No encontrado.' } });
      }

      if (path.startsWith('/webhooks') && env.CLOUDFLARE_ORIGIN_SECRET !== undefined) {
        const header = String(request.headers['x-origin-auth'] ?? '');
        if (!safeEqual(header, env.CLOUDFLARE_ORIGIN_SECRET)) {
          return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Origen no permitido.' } });
        }
      }

      const isMutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
      const origin = request.headers.origin;
      if (isMutation && path.startsWith('/v1') && origin && origin !== appOrigin) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Origen no permitido.' } });
      }
    });
  },
  { name: 'security' },
);
