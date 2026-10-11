import type { CustomerPrincipal, RequestMeta, StaffPrincipal } from '@estoicos/core';
import type { Permission } from '@estoicos/shared';

/**
 * Política de acceso OBLIGATORIA en cada ruta (config.policy). La API no arranca si una
 * ruta no la declara: el acceso falla cerrado.
 */
export type Policy =
  | { kind: 'public' }
  | { kind: 'webhook' }
  | { kind: 'customer' }
  | {
      kind: 'staff';
      permission?: Permission;
      /** Nombre del parámetro de la URL con la sucursal (se valida el acceso a ESA sucursal). */
      branchParam?: string;
      /** Solo para validar el segundo factor. */
      allowPendingSecondFactor?: boolean;
    };

export interface RegisteredRoute {
  method: string;
  url: string;
  policy: Policy;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Todas las rutas con su política (lo usa el test de la matriz de permisos). */
    routePolicies: RegisteredRoute[];
  }
  interface FastifyRequest {
    /** Cuerpo tal como llegó: lo necesitan las firmas de los webhooks. */
    rawBody?: string;
    meta: RequestMeta;
    staff: StaffPrincipal | null;
    customer: CustomerPrincipal | null;
  }
  interface FastifyContextConfig {
    policy?: Policy;
  }
}
