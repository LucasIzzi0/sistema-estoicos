import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, createTestContext, inviteAndAccept, loginStaff, type TestContext } from './helpers';

let ctx: TestContext;
let reception: string;
beforeEach(async () => {
  ctx = await createTestContext();
  const owner = await loginStaff(ctx, ADMIN_EMAIL);
  reception = await inviteAndAccept(ctx, owner, {
    email: 'rec@estoicos.test',
    role: 'RECEPTION',
    branchIds: [ctx.ids.branchId],
  });
});
afterEach(async () => {
  await ctx.close();
});

const base = {
  firstName: 'Ana',
  lastName: 'Suárez',
  phone: '11 4000-1234',
  email: 'ana@example.com',
  acceptTransactional: true,
  acceptMarketing: false,
};
const create = (payload: Record<string, unknown>) =>
  ctx.inject({ method: 'POST', url: '/v1/customers', cookie: reception, payload });
const search = async (q: string) =>
  (
    await ctx.inject({ method: 'GET', url: `/v1/customers?q=${encodeURIComponent(q)}`, cookie: reception })
  ).json() as {
    firstName: string;
  }[];

describe('alta rápida en el local', () => {
  it('crea el cliente con celular normalizado y consentimientos con fecha y quién los cargó', async () => {
    const res = await create({ ...base, dni: '40.123.456' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      phone: '+5491140001234',
      dni: '40123456',
      source: 'IN_STORE',
      consents: { transactional: true, marketing: false },
    });
    const events = await ctx.db.consentEvent.findMany({ where: { customerId: res.json().id } });
    expect(events).toHaveLength(4);
    expect(events.every((e) => e.source === 'IN_STORE' && e.recordedById && e.policyVersion)).toBe(true);
  });

  it('el email es obligatorio', async () => {
    const { email: _omit, ...withoutEmail } = base;
    const res = await create(withoutEmail);
    expect(res.statusCode).toBe(422);
  });

  it('mismo email o DNI: bloquea y muestra quién es', async () => {
    const byEmail = await create({ ...base, email: 'martin.gomez@example.com' });
    expect(byEmail.statusCode).toBe(409);
    expect(byEmail.json().error).toMatchObject({ code: 'DUPLICATE_CUSTOMER' });
    expect(byEmail.json().error.message).toMatch(/Martín Gómez/);
    const byDni = await create({ ...base, dni: '30111222' });
    expect(byDni.json().error.code).toBe('DUPLICATE_CUSTOMER');
  });

  it('mismo celular: avisa, y se puede confirmar que es otra persona (familia)', async () => {
    const warn = await create({ ...base, phone: '+5491122334455' });
    expect(warn.statusCode).toBe(409);
    expect(warn.json().error.code).toBe('POSSIBLE_DUPLICATE');
    const ok = await create({ ...base, phone: '+5491122334455', allowSamePhone: true });
    expect(ok.statusCode).toBe(201);
  });
});

describe('búsqueda', () => {
  it('sin acentos ni mayúsculas, por celular y por DNI', async () => {
    // "martin" encuentra a Martín Gómez y a Federico Martínez (ordenados por apellido).
    expect((await search('martin')).map((c) => c.firstName)).toEqual(['Martín', 'Federico']);
    expect((await search('GOMEZ mar')).map((c) => c.firstName)).toEqual(['Martín']);
    expect((await search('011 15 2233-4455')).map((c) => c.firstName)).toEqual(['Martín']);
    expect((await search('30.111.222')).map((c) => c.firstName)).toEqual(['Martín']);
    expect(await search('zzz')).toEqual([]);
  });
  it('encuentra a un cliente recién creado', async () => {
    await create(base);
    expect((await search('suarez')).map((c) => c.firstName)).toEqual(['Ana']);
  });
});

describe('ficha', () => {
  it('editar consentimientos deja historial; cambiar el email obliga a verificarlo de nuevo', async () => {
    const created = (await create(base)).json();
    await ctx.db.customer.update({ where: { id: created.id }, data: { emailVerifiedAt: new Date() } });
    const updated = await ctx.inject({
      method: 'PATCH',
      url: `/v1/customers/${created.id}`,
      cookie: reception,
      payload: { acceptMarketing: true, email: 'ana.nueva@example.com' },
    });
    expect(updated.json()).toMatchObject({
      email: 'ana.nueva@example.com',
      emailVerifiedAt: null,
      consents: { marketing: true },
    });
    const staffEvents = await ctx.db.consentEvent.count({
      where: { customerId: created.id, source: 'STAFF_UPDATE' },
    });
    expect(staffEvents).toBe(2);
    expect((await search('nueva')).map((c) => c.firstName)).toEqual(['Ana']);
  });

  it('notas: agregar, fijar y ocultar', async () => {
    const created = (await create(base)).json();
    const withNote = await ctx.inject({
      method: 'POST',
      url: `/v1/customers/${created.id}/notes`,
      cookie: reception,
      payload: { body: 'Degradé en 1, no le gusta la navaja' },
    });
    const note = withNote.json().notes[0];
    expect(note).toMatchObject({ body: 'Degradé en 1, no le gusta la navaja', pinned: false });
    const pinned = await ctx.inject({
      method: 'PATCH',
      url: `/v1/customers/${created.id}/notes/${note.id}`,
      cookie: reception,
      payload: { pinned: true },
    });
    expect(pinned.json().notes[0].pinned).toBe(true);
    const hidden = await ctx.inject({
      method: 'DELETE',
      url: `/v1/customers/${created.id}/notes/${note.id}`,
      cookie: reception,
    });
    expect(hidden.json().notes).toHaveLength(0);
    expect(await ctx.db.customerNote.count({ where: { id: note.id } })).toBe(1);
  });
});
