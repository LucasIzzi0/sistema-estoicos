import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ADMIN_EMAIL,
  inviteAndAccept,
  codeFromEmail,
  createTestContext,
  linkTokenFromEmail,
  loginStaff,
  PASSWORD,
  sessionCookie,
  type TestContext,
} from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.close();
});

const login = (email: string, password: string) =>
  ctx.inject({ method: 'POST', url: '/v1/auth/staff/login', payload: { email, password } });

describe('login del staff', () => {
  it('entra con email y contraseña y recibe sus permisos', async () => {
    const response = await login('DUENO@estoicos.test', PASSWORD);
    expect(response.statusCode).toBe(200);
    expect(response.json().me).toMatchObject({ accessLevel: 'OWNER', allBranches: true });
    expect(response.json().me.permissions).toContain('mercadopago:connect');
  });

  it('mismo mensaje si el email no existe o la contraseña está mal', async () => {
    const unknown = await login('nadie@estoicos.test', PASSWORD);
    const wrong = await login(ADMIN_EMAIL, 'incorrecta-1234');
    expect(unknown.statusCode).toBe(401);
    expect(wrong.statusCode).toBe(401);
    expect(unknown.json().error.message).toBe(wrong.json().error.message);
  });

  it('5 fallos seguidos bloquean la cuenta 15 minutos, aun con la contraseña correcta', async () => {
    for (let i = 0; i < 4; i++) expect((await login(ADMIN_EMAIL, 'mala-contraseña')).statusCode).toBe(401);
    expect((await login(ADMIN_EMAIL, 'mala-contraseña')).statusCode).toBe(429);
    const locked = await login(ADMIN_EMAIL, PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.message).toMatch(/minutos/);
    ctx.clock.advanceMinutes(16);
    expect((await login(ADMIN_EMAIL, PASSWORD)).statusCode).toBe(200);
  });

  it('un usuario desactivado no puede entrar', async () => {
    const owner = await loginStaff(ctx, ADMIN_EMAIL);
    await inviteAndAccept(ctx, owner, {
      email: 'rec@estoicos.test',
      role: 'RECEPTION',
      branchIds: [ctx.ids.branchId],
    });
    await ctx.db.user.update({ where: { email: 'rec@estoicos.test' }, data: { active: false } });
    expect((await login('rec@estoicos.test', 'contraseña-del-invitado')).statusCode).toBe(401);
  });

  it('cerrar sesión revoca la sesión en el servidor', async () => {
    const cookie = await loginStaff(ctx, ADMIN_EMAIL);
    await ctx.inject({ method: 'POST', url: '/v1/auth/staff/logout', cookie });
    expect((await ctx.inject({ method: 'GET', url: '/v1/me/staff', cookie })).statusCode).toBe(401);
  });

  it('las sesiones vencen a los 7 días sin uso', async () => {
    const cookie = await loginStaff(ctx, ADMIN_EMAIL);
    ctx.clock.advanceMinutes(8 * 24 * 60);
    expect((await ctx.inject({ method: 'GET', url: '/v1/me/staff', cookie })).statusCode).toBe(401);
  });
});

describe('segundo factor por email', () => {
  it('con 2FA activo, la sesión no sirve hasta validar el código', async () => {
    await ctx.db.user.update({ where: { email: ADMIN_EMAIL }, data: { twoFactorMethod: 'EMAIL_CODE' } });
    const response = await login(ADMIN_EMAIL, PASSWORD);
    expect(response.json()).toMatchObject({ requiresSecondFactor: true, me: null });
    const cookie = sessionCookie(response);

    const blocked = await ctx.inject({ method: 'GET', url: '/v1/me/staff', cookie });
    expect(blocked.statusCode).toBe(401);
    expect(blocked.json().error.code).toBe('SECOND_FACTOR_REQUIRED');

    const code = codeFromEmail(ctx.mailer);
    const verified = await ctx.inject({
      method: 'POST',
      url: '/v1/auth/staff/second-factor',
      cookie,
      payload: { code },
    });
    expect(verified.statusCode).toBe(200);
    expect((await ctx.inject({ method: 'GET', url: '/v1/me/staff', cookie })).statusCode).toBe(200);
  });
});

describe('invitaciones', () => {
  it('el dueño invita a una recepcionista, que define su contraseña y entra con acceso limitado', async () => {
    const owner = await loginStaff(ctx, ADMIN_EMAIL);
    const invited = await ctx.inject({
      method: 'POST',
      url: '/v1/staff/invitations',
      cookie: owner,
      payload: {
        email: 'nuevo@estoicos.test',
        name: 'Nuevo Barbero',
        role: 'RECEPTION',
        branchIds: [ctx.ids.branchId],
      },
    });
    expect(invited.statusCode).toBe(201);
    expect(invited.json()).toMatchObject({ role: 'RECEPTION', hasPassword: false });

    const token = linkTokenFromEmail(ctx.mailer);
    const info = await ctx.inject({ method: 'GET', url: `/v1/auth/staff/invitations/${token}` });
    expect(info.json()).toMatchObject({
      email: 'nuevo@estoicos.test',
      organizationName: 'Estoicos',
      role: 'RECEPTION',
    });

    const accepted = await ctx.inject({
      method: 'POST',
      url: '/v1/auth/staff/invitations/accept',
      payload: { token, password: 'una-contraseña-segura' },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ accessLevel: 'RECEPTION', branches: [{ id: ctx.ids.branchId }] });
    const reception = sessionCookie(accepted);
    expect((await ctx.inject({ method: 'GET', url: '/v1/staff', cookie: reception })).statusCode).toBe(403);

    // El link es de un solo uso.
    const reused = await ctx.inject({
      method: 'POST',
      url: '/v1/auth/staff/invitations/accept',
      payload: { token, password: 'otra-contraseña-segura' },
    });
    expect(reused.statusCode).toBe(404);

    const audit = await ctx.db.auditLog.findFirst({ where: { action: 'STAFF_INVITED' } });
    expect(audit?.actorUserId).toBe(ctx.ids.ownerId);
  });

  it('un encargado solo puede invitar recepcionistas a sus sucursales', async () => {
    const other = await ctx.db.branch.create({
      data: { organizationId: ctx.ids.organizationId, name: 'Sucursal Norte', slug: 'norte' },
    });
    const owner = await loginStaff(ctx, ADMIN_EMAIL);
    await ctx.inject({
      method: 'POST',
      url: '/v1/staff/invitations',
      cookie: owner,
      payload: {
        email: 'encargado@estoicos.test',
        name: 'Encargado',
        role: 'ADMIN',
        branchIds: [ctx.ids.branchId],
      },
    });
    const token = linkTokenFromEmail(ctx.mailer);
    const manager = sessionCookie(
      await ctx.inject({
        method: 'POST',
        url: '/v1/auth/staff/invitations/accept',
        payload: { token, password: 'contraseña-del-encargado' },
      }),
    );

    const adminInvite = await ctx.inject({
      method: 'POST',
      url: '/v1/staff/invitations',
      cookie: manager,
      payload: { email: 'x@estoicos.test', name: 'X', role: 'ADMIN', branchIds: [ctx.ids.branchId] },
    });
    expect(adminInvite.statusCode).toBe(403);
    const otherBranch = await ctx.inject({
      method: 'POST',
      url: '/v1/staff/invitations',
      cookie: manager,
      payload: { email: 'x@estoicos.test', name: 'X', role: 'RECEPTION', branchIds: [other.id] },
    });
    expect(otherBranch.statusCode).toBe(403);
    const ok = await ctx.inject({
      method: 'POST',
      url: '/v1/staff/invitations',
      cookie: manager,
      payload: { email: 'x@estoicos.test', name: 'X', role: 'RECEPTION', branchIds: [ctx.ids.branchId] },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('no se puede invitar dos veces a alguien que ya está en el equipo', async () => {
    const owner = await loginStaff(ctx, ADMIN_EMAIL);
    await inviteAndAccept(ctx, owner, {
      email: 'rec@estoicos.test',
      role: 'RECEPTION',
      branchIds: [ctx.ids.branchId],
    });
    const response = await ctx.inject({
      method: 'POST',
      url: '/v1/staff/invitations',
      cookie: owner,
      payload: { email: 'rec@estoicos.test', name: 'Rec', role: 'RECEPTION', branchIds: [ctx.ids.branchId] },
    });
    expect(response.statusCode).toBe(409);
  });
});

describe('cambios de acceso', () => {
  it('cambiar el acceso de alguien cierra sus sesiones al instante', async () => {
    const owner = await loginStaff(ctx, ADMIN_EMAIL);
    const reception = await inviteAndAccept(ctx, owner, {
      email: 'rec@estoicos.test',
      role: 'RECEPTION',
      branchIds: [ctx.ids.branchId],
    });
    expect((await ctx.inject({ method: 'GET', url: '/v1/me/staff', cookie: reception })).statusCode).toBe(
      200,
    );

    const members = (await ctx.inject({ method: 'GET', url: '/v1/staff', cookie: owner })).json() as {
      membershipId: string;
      email: string;
    }[];
    const receptionMembership = members.find((m) => m.email === 'rec@estoicos.test')!;
    const updated = await ctx.inject({
      method: 'PATCH',
      url: `/v1/staff/${receptionMembership.membershipId}`,
      cookie: owner,
      payload: { active: false },
    });
    expect(updated.statusCode).toBe(200);
    expect((await ctx.inject({ method: 'GET', url: '/v1/me/staff', cookie: reception })).statusCode).toBe(
      401,
    );
    expect(await ctx.db.auditLog.count({ where: { action: 'STAFF_DEACTIVATED' } })).toBe(1);
  });

  it('nadie modifica su propio acceso y siempre queda un dueño', async () => {
    const owner = await loginStaff(ctx, ADMIN_EMAIL);
    const me = (await ctx.inject({ method: 'GET', url: '/v1/me/staff', cookie: owner })).json();
    const self = await ctx.inject({
      method: 'PATCH',
      url: `/v1/staff/${me.membershipId}`,
      cookie: owner,
      payload: { active: false },
    });
    expect(self.statusCode).toBe(403);
  });
});

describe('recuperación de contraseña', () => {
  it('el link cambia la contraseña, cierra las sesiones y se usa una sola vez', async () => {
    const oldSession = await loginStaff(ctx, ADMIN_EMAIL);
    const requested = await ctx.inject({
      method: 'POST',
      url: '/v1/auth/staff/password-reset/request',
      payload: { email: ADMIN_EMAIL },
    });
    expect(requested.statusCode).toBe(202);
    const token = linkTokenFromEmail(ctx.mailer);

    const confirm = (password: string) =>
      ctx.inject({
        method: 'POST',
        url: '/v1/auth/staff/password-reset/confirm',
        payload: { token, password },
      });
    expect((await confirm('mi-contraseña-nueva-2026')).statusCode).toBe(200);
    expect((await confirm('otra-contraseña-2026')).statusCode).toBe(400);

    expect((await ctx.inject({ method: 'GET', url: '/v1/me/staff', cookie: oldSession })).statusCode).toBe(
      401,
    );
    expect((await login(ADMIN_EMAIL, PASSWORD)).statusCode).toBe(401);
    expect((await login(ADMIN_EMAIL, 'mi-contraseña-nueva-2026')).statusCode).toBe(200);
    expect(await ctx.db.auditLog.count({ where: { action: 'STAFF_PASSWORD_RESET' } })).toBe(1);
  });

  it('responde igual para un email que no existe y no envía nada', async () => {
    const response = await ctx.inject({
      method: 'POST',
      url: '/v1/auth/staff/password-reset/request',
      payload: { email: 'nadie@estoicos.test' },
    });
    expect(response.statusCode).toBe(202);
    expect(ctx.mailer.sent).toHaveLength(0);
  });

  it('exige contraseñas de al menos 10 caracteres', async () => {
    await ctx.inject({
      method: 'POST',
      url: '/v1/auth/staff/password-reset/request',
      payload: { email: ADMIN_EMAIL },
    });
    const token = linkTokenFromEmail(ctx.mailer);
    const response = await ctx.inject({
      method: 'POST',
      url: '/v1/auth/staff/password-reset/confirm',
      payload: { token, password: 'corta' },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toMatch(/10 caracteres/);
  });
});
