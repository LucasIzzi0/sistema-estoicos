import { DomainError } from '@estoicos/core';
import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors, isResponseSerializationError } from 'fastify-type-provider-zod';

/** Todos los errores salen con la misma forma: { error: { code, message, details? } }, en español. */
export const errorsPlugin = fp(
  async (app: FastifyInstance) => {
    app.setErrorHandler((error: FastifyError & { code?: string }, request, reply) => {
      if (error instanceof DomainError) {
        return reply
          .code(error.status)
          .send({ error: { code: error.code, message: error.message, details: error.details } });
      }
      if (hasZodFastifySchemaValidationErrors(error)) {
        return reply.code(422).send({
          error: {
            code: 'VALIDATION',
            message: error.validation[0]?.message ?? 'Revisá los datos ingresados.',
            details: error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
          },
        });
      }
      if (error.statusCode === 429) {
        return reply.code(429).send({
          error: {
            code: 'TOO_MANY_REQUESTS',
            message: error.message || 'Hiciste demasiados pedidos. Esperá un momento.',
          },
        });
      }
      if (isResponseSerializationError(error)) {
        request.log.error({ err: error, issues: error.cause.issues }, 'La respuesta no cumple su contrato');
      } else if (error.statusCode && error.statusCode < 500) {
        return reply
          .code(error.statusCode)
          .send({ error: { code: error.code ?? 'BAD_REQUEST', message: 'El pedido no es válido.' } });
      } else {
        request.log.error({ err: error }, 'Error inesperado');
      }
      return reply
        .code(500)
        .send({ error: { code: 'INTERNAL', message: 'Ocurrió un error inesperado. Probá de nuevo.' } });
    });

    app.setNotFoundHandler((_request, reply) =>
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No encontrado.' } }),
    );
  },
  { name: 'errors' },
);
