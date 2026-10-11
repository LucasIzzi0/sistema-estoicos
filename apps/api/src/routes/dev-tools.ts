import { dueReminders, queueReminder, sendNotification, unsubscribeUrl } from '@estoicos/core';
import type { FakeMercadoPago } from '@estoicos/integrations';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AppContext } from '../app';

/**
 * Rutas de DESARROLLO: hacen de "terminal" del Point y adelantan los jobs de notificaciones,
 * para poder probar los circuitos completos sin un Point real ni esperar a que pase el tiempo.
 *
 * Solo se registran fuera de producción (ver app.ts). En producción no existen.
 */
export const devToolsRoutes: FastifyPluginAsyncZod<{ ctx: AppContext; fake: FakeMercadoPago }> = async (
  app,
  { ctx, fake },
) => {
  const { deps } = ctx;
  const result = z.object({ ok: z.boolean(), detail: z.string() });

  app.post(
    '/v1/dev/mercadopago/simulate',
    {
      config: { policy: { kind: 'staff', permission: 'sales:charge' } },
      schema: {
        body: z.object({ action: z.enum(['at_terminal', 'pay', 'reject']) }),
        response: { 200: result },
      },
    },
    async (request) => {
      const order = await deps.db.mpOrder.findFirst({
        where: { status: 'PENDING', externalId: { not: null } },
        orderBy: { createdAt: 'desc' },
      });
      if (!order?.externalId) return { ok: false, detail: 'No hay ningún cobro esperando en la terminal.' };

      switch (request.body.action) {
        case 'at_terminal':
          fake.atTerminal(order.externalId);
          return { ok: true, detail: 'La terminal tomó el cobro.' };
        case 'pay':
          fake.atTerminal(order.externalId);
          fake.payOrder(order.externalId);
          return { ok: true, detail: 'El cliente pagó.' };
        case 'reject':
          fake.rejectOrder(order.externalId);
          return { ok: true, detail: 'El cobro se rechazó.' };
      }
    },
  );

  // --- Notificaciones: adelantar los jobs y leer los links de los recordatorios ---
  app.post(
    '/v1/dev/notificaciones/recordatorios',
    {
      config: { policy: { kind: 'staff', permission: 'notifications:settings' } },
      schema: { response: { 200: result } },
    },
    async () => {
      const due = await dueReminders(deps);
      let sent = 0;
      for (const item of due) {
        const id = await queueReminder(deps, item);
        if (id) {
          await sendNotification(deps, id);
          sent += 1;
        }
      }
      return { ok: sent > 0, detail: sent > 0 ? `${sent} recordatorio(s)` : 'Ningún turno entra todavía en la ventana.' };
    },
  );

  app.get(
    '/v1/dev/notificaciones/ultimo-recordatorio',
    {
      config: { policy: { kind: 'staff', permission: 'notifications:settings' } },
      schema: { response: { 200: z.object({ confirmUrl: z.string().nullable(), cancelUrl: z.string().nullable() }) } },
    },
    async () => {
      const last = await deps.db.notification.findFirst({
        where: { type: 'BOOKING_REMINDER' },
        orderBy: { createdAt: 'desc' },
      });
      const payload = (last?.payload ?? {}) as { confirmUrl?: string; cancelUrl?: string };
      return { confirmUrl: payload.confirmUrl ?? null, cancelUrl: payload.cancelUrl ?? null };
    },
  );

  app.get(
    '/v1/dev/notificaciones/baja',
    {
      config: { policy: { kind: 'staff', permission: 'notifications:settings' } },
      schema: { response: { 200: z.object({ url: z.string() }) } },
    },
    async (request) => {
      const customer = await deps.db.customer.findFirstOrThrow({
        where: { organizationId: request.staff!.organizationId, anonymizedAt: null },
        orderBy: { createdAt: 'desc' },
      });
      return { url: unsubscribeUrl(deps, customer.id) };
    },
  );
};
