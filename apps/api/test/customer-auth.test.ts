import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { codeFromEmail, createTestContext, sessionCookie, type TestContext } from './helpers';

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.close();
});

const requestCode = (email: string) =>
  ctx.inject({ method: 'POST', url: '/v1/auth/customer/request-code', payload: { email } });
const verify = (email: string, code: string) =>
  ctx.inject({ method: 'POST', url: '/v1/auth/customer/verify-code', payload: { email, code } });

describe('acceso de clientes con código por email', () => {
  it('flujo completo: código → sesión → completar perfil con consentimientos', async () => {
    expect((await requestCode('Nuevo.Cliente@Example.com')).statusCode).toBe(202);
    expect(ctx.mailer.last()?.to).toBe('nuevo.cliente@example.com');

    const code = codeFromEmail(ctx.mailer);
    const verified = await verify('nuevo.cliente@example.com', code);
    expect(verified.statusCode).toBe(200);
    expect(verified.json()).toMatchObject({ isNew: true, customer: { needsProfile: true } });
    const cookie = sessionCookie(verified);
    expect(verified.cookies[0]).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });

    const profile = await ctx.inject({
      method: 'PUT',
      url: '/v1/me/customer/profile',
      cookie,
      payload: {
        firstName: 'Ana',
        lastName: 'Suárez',
        phone: '11 5555-6666',
        acceptTransactional: true,
        acceptMarketing: false,
      },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json()).toMatchObject({
      phone: '+5491155556666',
      needsProfile: false,
      consents: { transactional: true, marketing: false },
    });

    const customerId = profile.json().id as string;
    expect(await ctx.db.consentEvent.count({ where: { customerId } })).toBe(4);
    // Guardar lo mismo otra vez no genera eventos nuevos.
    await ctx.inject({
      method: 'PUT',
      url: '/v1/me/customer/profile',
      cookie,
      payload: {
        firstName: 'Ana',
        lastName: 'Suárez',
        phone: '+5491155556666',
        acceptTransactional: true,
        acceptMarketing: false,
      },
    });
    expect(await ctx.db.consentEvent.count({ where: { customerId } })).toBe(4);
  });

  it('un cliente existente entra a su misma ficha', async () => {
    await requestCode('martin.gomez@example.com');
    const verified = await verify('martin.gomez@example.com', codeFromEmail(ctx.mailer));
    expect(verified.json()).toMatchObject({
      isNew: false,
      customer: { firstName: 'Martín', needsProfile: false },
    });
  });

  it('el código se guarda hasheado y el log de envíos no lo contiene', async () => {
    await requestCode('ana@example.com');
    const code = codeFromEmail(ctx.mailer);
    const stored = await ctx.db.authCode.findFirstOrThrow({ where: { email: 'ana@example.com' } });
    expect(stored.codeHash).not.toContain(code);
    const log = await ctx.db.notification.findFirstOrThrow({ where: { recipient: 'ana@example.com' } });
    expect(JSON.stringify(log.payload)).not.toContain(code);
    expect(log.status).toBe('SENT');
  });

  it('vence a los 10 minutos', async () => {
    await requestCode('ana@example.com');
    const code = codeFromEmail(ctx.mailer);
    ctx.clock.advanceMinutes(11);
    const response = await verify('ana@example.com', code);
    expect(response.statusCode).toBe(400);
    expect(response.json().error.message).toMatch(/venció/);
  });

  it('permite 5 intentos: después ni el código correcto sirve', async () => {
    await requestCode('ana@example.com');
    const code = codeFromEmail(ctx.mailer);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 1; i <= 4; i++) {
      const response = await verify('ana@example.com', wrong);
      expect(response.json().error.message).toContain(`${5 - i}`);
    }
    expect((await verify('ana@example.com', wrong)).json().error.message).toMatch(/Superaste/);
    const response = await verify('ana@example.com', code);
    expect(response.statusCode).toBe(400);
  });

  it('pedir un código nuevo invalida el anterior', async () => {
    await requestCode('ana@example.com');
    const first = codeFromEmail(ctx.mailer);
    await requestCode('ana@example.com');
    const second = codeFromEmail(ctx.mailer);
    if (first !== second) expect((await verify('ana@example.com', first)).statusCode).toBe(400);
    expect((await verify('ana@example.com', second)).statusCode).toBe(200);
  });

  it('el código se usa una sola vez', async () => {
    await requestCode('ana@example.com');
    const code = codeFromEmail(ctx.mailer);
    expect((await verify('ana@example.com', code)).statusCode).toBe(200);
    expect((await verify('ana@example.com', code)).statusCode).toBe(400);
  });

  it('límite por email: máximo 3 códigos cada 15 minutos', async () => {
    for (let i = 0; i < 3; i++) expect((await requestCode('ana@example.com')).statusCode).toBe(202);
    const blocked = await requestCode('ana@example.com');
    expect(blocked.statusCode).toBe(429);
    ctx.clock.advanceMinutes(16);
    expect((await requestCode('ana@example.com')).statusCode).toBe(202);
  });

  it('límite por IP en el pedido de códigos', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await requestCode(`persona${i}@example.com`)).statusCode);
    expect(statuses.slice(0, 20).every((s) => s === 202)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it('si el email no sale, avisa con un error claro y lo registra como fallido', async () => {
    const { EmailSendError } = await import('@estoicos/integrations');
    ctx.mailer.failNext = new EmailSendError('caído');
    const response = await requestCode('ana@example.com');
    expect(response.statusCode).toBe(503);
    expect(response.json().error.message).toMatch(/No pudimos enviar/);
    expect(
      (await ctx.db.notification.findFirstOrThrow({ where: { recipient: 'ana@example.com' } })).status,
    ).toBe('FAILED');
  });

  it('cerrar sesión revoca la sesión', async () => {
    await requestCode('ana@example.com');
    const cookie = sessionCookie(await verify('ana@example.com', codeFromEmail(ctx.mailer)));
    expect((await ctx.inject({ method: 'GET', url: '/v1/me/customer', cookie })).statusCode).toBe(200);
    await ctx.inject({ method: 'POST', url: '/v1/auth/customer/logout', cookie });
    expect((await ctx.inject({ method: 'GET', url: '/v1/me/customer', cookie })).statusCode).toBe(401);
  });

  it('valida el celular', async () => {
    await requestCode('ana@example.com');
    const cookie = sessionCookie(await verify('ana@example.com', codeFromEmail(ctx.mailer)));
    const response = await ctx.inject({
      method: 'PUT',
      url: '/v1/me/customer/profile',
      cookie,
      payload: {
        firstName: 'Ana',
        lastName: 'S',
        phone: '123',
        acceptTransactional: true,
        acceptMarketing: false,
      },
    });
    expect(response.statusCode).toBe(422);
    expect(response.json().error.message).toMatch(/celular/);
  });
});
