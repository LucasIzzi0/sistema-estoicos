import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ADMIN_EMAIL, createTestContext, inviteAndAccept, loginStaff, PRECIO, SERVICIOS_ACTIVOS, type TestContext } from './helpers';

let ctx: TestContext;
let owner: string;
beforeEach(async () => {
  ctx = await createTestContext();
  owner = await loginStaff(ctx, ADMIN_EMAIL);
});
afterEach(async () => {
  await ctx.close();
});

const newService = (payload: Record<string, unknown>) =>
  ctx.inject({ method: 'POST', url: '/v1/services', cookie: owner, payload });

describe('servicios', () => {
  it('crea un servicio ofrecido en todas las sucursales', async () => {
    const created = await newService({
      name: 'Diseño',
      categoryId: null,
      durationMin: 20,
      basePriceCents: 500_000,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: 'Diseño',
      basePriceCents: 500_000,
      depositMode: 'NONE',
      branches: [{ branchId: ctx.ids.branchId, offered: true, priceCentsOverride: null }],
    });
  });

  it('valida duración y seña', async () => {
    expect(
      (await newService({ name: 'X', categoryId: null, durationMin: 7, basePriceCents: 100 })).statusCode,
    ).toBe(422);
    const noAmount = await newService({
      name: 'X',
      categoryId: null,
      durationMin: 30,
      basePriceCents: 1_000_000,
      depositMode: 'FIXED',
    });
    expect(noAmount.statusCode).toBe(422);
    expect(noAmount.json().error.message).toMatch(/monto de la seña/);
    const ok = await newService({
      name: 'Color',
      categoryId: null,
      durationMin: 90,
      basePriceCents: 3_000_000,
      depositMode: 'PERCENT',
      depositPercentBps: 3000,
    });
    expect(ok.json()).toMatchObject({
      depositMode: 'PERCENT',
      depositPercentBps: 3000,
      depositFixedCents: null,
    });
  });

  it('un cambio de precio queda auditado con el antes y el después', async () => {
    const service = (
      await newService({ name: 'Diseño', categoryId: null, durationMin: 20, basePriceCents: 500_000 })
    ).json();
    await ctx.inject({
      method: 'PATCH',
      url: `/v1/services/${service.id}`,
      cookie: owner,
      payload: { basePriceCents: 600_000 },
    });
    const audit = await ctx.db.auditLog.findFirstOrThrow({
      where: { action: 'SERVICE_PRICE_CHANGED', entityId: service.id },
    });
    expect(audit.before).toEqual({ basePriceCents: 500_000 });
    expect(audit.after).toEqual({ basePriceCents: 600_000 });
  });

  it('archivar lo saca de la lista (sigue existiendo para el historial)', async () => {
    const service = (
      await newService({ name: 'Viejo', categoryId: null, durationMin: 20, basePriceCents: 1 })
    ).json();
    await ctx.inject({
      method: 'PATCH',
      url: `/v1/services/${service.id}`,
      cookie: owner,
      payload: { archived: true },
    });
    const list = (await ctx.inject({ method: 'GET', url: '/v1/services', cookie: owner })).json() as {
      id: string;
    }[];
    expect(list.map((s) => s.id)).not.toContain(service.id);
    const all = (
      await ctx.inject({ method: 'GET', url: '/v1/services?includeArchived=true', cookie: owner })
    ).json() as {
      id: string;
      archived: boolean;
    }[];
    expect(all.find((s) => s.id === service.id)?.archived).toBe(true);
  });

  it('el encargado pone precio propio en SU sucursal, no en otra', async () => {
    const other = await ctx.db.branch.create({
      data: { organizationId: ctx.ids.organizationId, name: 'Norte', slug: 'norte' },
    });
    const manager = await inviteAndAccept(ctx, owner, {
      email: 'enc@estoicos.test',
      role: 'ADMIN',
      branchIds: [ctx.ids.branchId],
    });
    const corte = await ctx.db.service.findFirstOrThrow({ where: { name: 'Corte' } });

    const own = await ctx.inject({
      method: 'PUT',
      url: `/v1/branches/${ctx.ids.branchId}/services/${corte.id}`,
      cookie: manager,
      payload: { offered: true, priceCentsOverride: 1_700_000 },
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().branches).toEqual([
      { branchId: ctx.ids.branchId, offered: true, priceCentsOverride: 1_700_000 },
    ]);
    expect(
      await ctx.db.auditLog.count({ where: { action: 'SERVICE_PRICE_CHANGED', branchId: ctx.ids.branchId } }),
    ).toBe(1);

    const foreign = await ctx.inject({
      method: 'PUT',
      url: `/v1/branches/${other.id}/services/${corte.id}`,
      cookie: manager,
      payload: { offered: true, priceCentsOverride: 1 },
    });
    expect(foreign.statusCode).toBe(403);
  });

  it('aumento masivo: porcentaje con redondeo, también en precios por sucursal, y auditado', async () => {
    const corte = await ctx.db.service.findFirstOrThrow({ where: { name: 'Corte' } });
    await ctx.inject({
      method: 'PUT',
      url: `/v1/branches/${ctx.ids.branchId}/services/${corte.id}`,
      cookie: owner,
      payload: { offered: true, priceCentsOverride: 1_600_000 },
    });
    const result = await ctx.inject({
      method: 'POST',
      url: '/v1/services/bulk-price',
      cookie: owner,
      payload: { percentBps: 1200, roundToCents: 10_000 },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json().updated).toBe(SERVICIOS_ACTIVOS);
    expect(result.json().changes).toContainEqual({
      id: corte.id,
      name: 'Corte',
      before: PRECIO.corte,
      after: 2_800_000, // $25.000 + 12 % = $28.000
    });

    const branchPrice = await ctx.db.branchService.findUniqueOrThrow({
      where: { branchId_serviceId: { branchId: ctx.ids.branchId, serviceId: corte.id } },
    });
    expect(branchPrice.priceCentsOverride).toBe(1_790_000n); // $16.000 + 12 % = $17.920 → $17.900
    expect(
      await ctx.db.auditLog.count({
        where: { action: 'SERVICE_PRICE_CHANGED', summary: { startsWith: 'Aumento masivo' } },
      }),
    ).toBe(SERVICIOS_ACTIVOS);
  });

  it('el aumento masivo exige un porcentaje distinto de cero', async () => {
    const response = await ctx.inject({
      method: 'POST',
      url: '/v1/services/bulk-price',
      cookie: owner,
      payload: { percentBps: 0, roundToCents: 100 },
    });
    expect(response.statusCode).toBe(422);
  });
});

describe('categorías y productos', () => {
  it('no se repiten nombres de categoría', async () => {
    const dup = await ctx.inject({
      method: 'POST',
      url: '/v1/service-categories',
      cookie: owner,
      payload: { name: 'Cortes' },
    });
    expect(dup.statusCode).toBe(409);
  });

  it('editar una categoría puede cambiar solo el orden', async () => {
    const cat = await ctx.db.serviceCategory.findFirstOrThrow({ where: { name: 'Barba' } });
    const res = await ctx.inject({
      method: 'PATCH',
      url: `/v1/service-categories/${cat.id}`,
      cookie: owner,
      payload: { sortOrder: 9 },
    });
    expect(res.json()).toMatchObject({ name: 'Barba', sortOrder: 9 });
  });

  it('productos: SKU único y precio auditado', async () => {
    const dup = await ctx.inject({
      method: 'POST',
      url: '/v1/products',
      cookie: owner,
      payload: { name: 'Otra cera', categoryId: null, sku: 'CERA-MATE', basePriceCents: 100 },
    });
    expect(dup.statusCode).toBe(409);
    const cera = await ctx.db.product.findFirstOrThrow({ where: { sku: 'CERA-MATE' } });
    await ctx.inject({
      method: 'PATCH',
      url: `/v1/products/${cera.id}`,
      cookie: owner,
      payload: { basePriceCents: 1_300_000 },
    });
    expect(await ctx.db.auditLog.count({ where: { action: 'PRODUCT_PRICE_CHANGED' } })).toBe(1);
  });
});
