import {
  Errors,
  loadStaffPrincipal,
  requireBranchAccess,
  requirePermission,
  resolveSession,
  type CoreDeps,
} from '@estoicos/core';
import { CUSTOMER_AUTH, STAFF_AUTH } from '@estoicos/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { ApiConfig } from '../config';
import type { RegisteredRoute } from './types';

/**
 * Autenticación y autorización de cada pedido según la política de la ruta.
 * - onRoute: toda ruta DEBE declarar `config.policy` (si falta, la API no arranca).
 * - preValidation: resuelve la sesión y verifica rol, permiso y sucursal ANTES de tocar el body.
 */
export const policyPlugin = fp(
  async (app: FastifyInstance, opts: { deps: CoreDeps; config: ApiConfig }) => {
    const { deps, config } = opts;
    app.decorateRequest('staff', null);
    app.decorateRequest('customer', null);

    const registered: RegisteredRoute[] = [];
    app.decorate('routePolicies', registered);

    app.addHook('onRoute', (route) => {
      if (!route.config?.policy) {
        throw new Error(
          `La ruta ${String(route.method)} ${route.url} no declara su política de acceso (config.policy).`,
        );
      }
      for (const method of [route.method].flat()) {
        if (method !== 'HEAD') registered.push({ method, url: route.url, policy: route.config.policy });
      }
    });

    app.addHook('preValidation', async (request) => {
      const policy = request.routeOptions.config.policy;
      if (!policy) throw Errors.forbidden();

      if (policy.kind === 'public' || policy.kind === 'webhook') return;

      if (policy.kind === 'customer') {
        const token = request.cookies[config.cookieNames.customer];
        const session = token
          ? await resolveSession(deps.db, token, 'CUSTOMER', CUSTOMER_AUTH.sessionDays, deps.now())
          : null;
        if (!session?.customerId) throw Errors.unauthenticated();
        request.customer = {
          kind: 'customer',
          sessionId: session.id,
          customerId: session.customerId,
          organizationId: session.organizationId,
        };
        return;
      }

      // staff
      const principal = await resolveStaff(request);
      if (!principal) throw Errors.unauthenticated();
      if (principal.secondFactorPending && !policy.allowPendingSecondFactor)
        throw Errors.secondFactorRequired();
      if (policy.permission) requirePermission(principal, policy.permission);
      if (policy.branchParam) {
        const branchId = (request.params as Record<string, string | undefined>)[policy.branchParam];
        if (!branchId) throw Errors.forbidden('Falta indicar la sucursal.');
        requireBranchAccess(principal, branchId);
      }
      request.staff = principal;
    });

    async function resolveStaff(request: FastifyRequest) {
      const token = request.cookies[config.cookieNames.staff];
      if (!token) return null;
      const session = await resolveSession(deps.db, token, 'STAFF', STAFF_AUTH.sessionDays, deps.now());
      return session ? loadStaffPrincipal(deps.db, session) : null;
    }
  },
  { name: 'policy', dependencies: ['security'] },
);
