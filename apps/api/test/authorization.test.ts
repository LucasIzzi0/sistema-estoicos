import { hasPermission, type AccessLevel } from '@estoicos/shared';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { policyPlugin } from '../src/plugins/policy';
import { securityPlugin } from '../src/plugins/security';
import { loadConfig } from '../src/config';
import {
  ADMIN_EMAIL,
  codeFromEmail,
  createTestContext,
  inviteAndAccept,
  linkTokenFromEmail,
  loginStaff,
  sessionCookie,
  type TestContext,
} from './helpers';

let ctx: TestContext;
const cookies: Record<'owner' | 'manager' | 'reception' | 'customer', string> = {} as never;
let otherBranchId: string;

beforeAll(async () => {
  ctx = await createTestContext();
  otherBranchId = (
    await ctx.db.branch.create({
      data: { organizationId: ctx.ids.organizationId, name: 'Sucursal Norte', slug: 'norte' },
    })
  ).id;

  cookies.owner = await loginStaff(ctx, ADMIN_EMAIL);

  // Encargado (ADMIN) limitado a la sucursal principal.
  await ctx.inject({
    method: 'POST',
    url: '/v1/staff/invitations',
    cookie: cookies.owner,
    payload: {
      email: 'encargado@estoicos.test',
      name: 'Encargado',
      role: 'ADMIN',
      branchIds: [ctx.ids.branchId],
    },
  });
  cookies.manager = sessionCookie(
    await ctx.inject({
      method: 'POST',
      url: '/v1/auth/staff/invitations/accept',
      payload: { token: linkTokenFromEmail(ctx.mailer), password: 'contraseña-del-encargado' },
    }),
  );

  cookies.reception = await inviteAndAccept(ctx, cookies.owner, {
    email: 'recepcion@estoicos.test',
    role: 'RECEPTION',
    branchIds: [ctx.ids.branchId],
  });

  await ctx.inject({
    method: 'POST',
    url: '/v1/auth/customer/request-code',
    payload: { email: 'cliente@example.com' },
  });
  cookies.customer = sessionCookie(
    await ctx.inject({
      method: 'POST',
      url: '/v1/auth/customer/verify-code',
      payload: { email: 'cliente@example.com', code: codeFromEmail(ctx.mailer) },
    }),
  );
});

afterAll(async () => {
  await ctx.close();
});

function fillUrl(url: string): string {
  return url
    .replace(':branchId', ctx.ids.branchId)
    .replace(/:[A-Za-z]+Id/g, '00000000-0000-7000-8000-000000000000')
    .replace(':token', 'x'.repeat(40));
}

describe('matriz de permisos: todas las rutas × todos los roles', () => {
  it('toda ruta declara su política (hay rutas registradas)', () => {
    expect(ctx.app.routePolicies.length).toBeGreaterThan(10);
  });

  it('sin sesión: toda ruta de staff o de cliente responde 401', async () => {
    for (const route of ctx.app.routePolicies) {
      if (route.policy.kind !== 'staff' && route.policy.kind !== 'customer') continue;
      const response = await ctx.inject({
        method: route.method as 'GET',
        url: fillUrl(route.url),
        payload: {},
      });
      expect(response.statusCode, `${route.method} ${route.url}`).toBe(401);
    }
  });

  it('una sesión de cliente no abre rutas de staff, y una de staff no abre rutas de cliente', async () => {
    for (const route of ctx.app.routePolicies) {
      if (route.policy.kind === 'staff') {
        const r = await ctx.inject({
          method: route.method as 'GET',
          url: fillUrl(route.url),
          cookie: cookies.customer,
          payload: {},
        });
        expect(r.statusCode, `${route.method} ${route.url}`).toBe(401);
      }
      if (route.policy.kind === 'customer') {
        const r = await ctx.inject({
          method: route.method as 'GET',
          url: fillUrl(route.url),
          cookie: cookies.owner,
          payload: {},
        });
        expect(r.statusCode, `${route.method} ${route.url}`).toBe(401);
      }
    }
  });

  const levels: [AccessLevel, keyof typeof cookies][] = [
    ['OWNER', 'owner'],
    ['BRANCH_ADMIN', 'manager'],
    ['RECEPTION', 'reception'],
  ];
  for (const [level, who] of levels) {
    it(`${level}: 403 exactamente donde la matriz lo niega`, async () => {
      // La matriz pega en TODAS las rutas: sin limpiar el contador, el límite por IP (600/min)
      // se come el final de la lista y el test miente un 429 por un 403.
      await ctx.redis.flushdb();
      for (const route of ctx.app.routePolicies) {
        if (route.policy.kind !== 'staff' || route.policy.allowPendingSecondFactor) continue;
        const response = await ctx.inject({
          method: route.method as 'GET',
          url: fillUrl(route.url),
          cookie: cookies[who],
          payload: {},
        });
        const allowed = !route.policy.permission || hasPermission(level, route.policy.permission);
        const label = `${level} ${route.method} ${route.url} → ${response.statusCode} ${response.body.slice(0, 120)}`;
        if (allowed) {
          expect([401, 403], label).not.toContain(response.statusCode);
        } else {
          expect(response.statusCode, label).toBe(403);
        }
      }
    });
  }
});

describe('alcance por sucursal', () => {
  it('el encargado no accede a otra sucursal; el dueño sí', async () => {
    const url = `/v1/branches/${otherBranchId}`;
    expect((await ctx.inject({ method: 'GET', url, cookie: cookies.manager })).statusCode).toBe(403);
    expect((await ctx.inject({ method: 'GET', url, cookie: cookies.reception })).statusCode).toBe(403);
    expect((await ctx.inject({ method: 'GET', url, cookie: cookies.owner })).statusCode).toBe(200);
  });

  it('el selector de sucursal solo muestra las permitidas', async () => {
    const manager = (
      await ctx.inject({ method: 'GET', url: '/v1/branches', cookie: cookies.manager })
    ).json();
    const owner = (await ctx.inject({ method: 'GET', url: '/v1/branches', cookie: cookies.owner })).json();
    expect(manager.map((b: { id: string }) => b.id)).toEqual([ctx.ids.branchId]);
    expect(owner).toHaveLength(2);
  });
});

describe('barreras de red', () => {
  it('las rutas /v1 pedidas sin el secreto interno responden 404', async () => {
    const response = await ctx.app.inject({
      method: 'GET',
      url: '/v1/me/staff',
      headers: { cookie: cookies.owner },
    });
    expect(response.statusCode).toBe(404);
  });

  it('una mutación con un Origin ajeno se rechaza (CSRF)', async () => {
    const response = await ctx.inject({
      method: 'POST',
      url: '/v1/auth/staff/logout',
      cookie: cookies.owner,
      headers: { origin: 'https://sitio-malicioso.example' },
    });
    expect(response.statusCode).toBe(403);
  });

  it('la API no arranca si una ruta no declara su política', async () => {
    const config = loadConfig({ ...process.env, APP_ENV: 'test' });
    const app = Fastify();
    await app.register(securityPlugin, { config });
    await app.register(policyPlugin, { deps: {} as never, config });
    expect(() => app.get('/v1/sin-politica', async () => 'hola')).toThrow(/no declara su política/);
    await app.close();
  });
});
