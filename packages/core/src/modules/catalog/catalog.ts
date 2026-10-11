import type { Prisma, Tx } from '@estoicos/db';
import {
  applyPercentChange,
  bulkPriceBody,
  categoryBody,
  createProductBody,
  createServiceBody,
  depositProblem,
  setBranchProductBody,
  setBranchServiceBody,
  updateProductBody,
  updateServiceBody,
  type BulkPriceBody,
  type BulkPriceResult,
  type Category,
  type CreateProductBody,
  type CreateServiceBody,
  type ProductDto,
  type ServiceDto,
  type UpdateProductBody,
  type UpdateServiceBody,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors, isUniqueViolation } from '../../errors';
import { writeAudit } from '../audit/audit';

const num = (v: bigint | null | undefined): number | null =>
  v === null || v === undefined ? null : Number(v);
const big = (v: number | null | undefined): bigint | null =>
  v === null || v === undefined ? null : BigInt(v);

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------

type CategoryKind = 'service' | 'product';

export async function listCategories(
  deps: CoreDeps,
  p: StaffPrincipal,
  kind: CategoryKind,
): Promise<Category[]> {
  requirePermission(p, 'catalog:read');
  const where = { organizationId: p.organizationId };
  const orderBy = [{ sortOrder: 'asc' as const }, { name: 'asc' as const }];
  const rows =
    kind === 'service'
      ? await deps.db.serviceCategory.findMany({ where, orderBy })
      : await deps.db.productCategory.findMany({ where, orderBy });
  return rows.map(({ id, name, sortOrder, active }) => ({ id, name, sortOrder, active }));
}

export async function saveCategory(
  deps: CoreDeps,
  p: StaffPrincipal,
  kind: CategoryKind,
  rawBody: Partial<z.input<typeof categoryBody>>,
  categoryId?: string,
): Promise<Category> {
  requirePermission(p, 'catalog:manage');
  // Al editar se puede mandar solo lo que cambia (ej. el orden).
  const body = categoryId ? categoryBody.partial().parse(rawBody) : categoryBody.parse(rawBody);
  try {
    const delegate = (
      kind === 'service' ? deps.db.serviceCategory : deps.db.productCategory
    ) as typeof deps.db.serviceCategory;
    if (categoryId) {
      const existing = await delegate.findFirst({
        where: { id: categoryId, organizationId: p.organizationId },
      });
      if (!existing) throw Errors.notFound('No encontramos esa categoría.');
      const updated = await delegate.update({ where: { id: categoryId }, data: body });
      return { id: updated.id, name: updated.name, sortOrder: updated.sortOrder, active: updated.active };
    }
    const created = await delegate.create({
      data: { organizationId: p.organizationId, name: body.name!, ...body },
    });
    return { id: created.id, name: created.name, sortOrder: created.sortOrder, active: created.active };
  } catch (error) {
    if (isUniqueViolation(error)) throw Errors.conflict('Ya existe una categoría con ese nombre.');
    throw error;
  }
}

async function assertCategory(
  tx: Tx,
  p: StaffPrincipal,
  kind: CategoryKind,
  categoryId: string | null | undefined,
) {
  if (!categoryId) return;
  const where = { id: categoryId, organizationId: p.organizationId };
  const found =
    kind === 'service'
      ? await tx.serviceCategory.findFirst({ where })
      : await tx.productCategory.findFirst({ where });
  if (!found) throw Errors.invalid('La categoría elegida no existe.');
}

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------

const serviceInclude = { category: true, branchServices: true } as const;
type ServiceRow = Prisma.ServiceGetPayload<{ include: typeof serviceInclude }>;

function toServiceDto(s: ServiceRow, visibleBranchIds: string[]): ServiceDto {
  return {
    id: s.id,
    categoryId: s.categoryId,
    categoryName: s.category?.name ?? null,
    name: s.name,
    description: s.description,
    durationMin: s.durationMin,
    basePriceCents: Number(s.basePriceCents),
    active: s.active,
    onlineBookable: s.onlineBookable,
    pointsOverride: s.pointsOverride,
    commissionBpsOverride: s.commissionBpsOverride,
    depositMode: s.depositMode,
    depositFixedCents: num(s.depositFixedCents),
    depositPercentBps: s.depositPercentBps,
    sortOrder: s.sortOrder,
    archived: Boolean(s.archivedAt),
    branches: visibleBranchIds.map((branchId) => {
      const row = s.branchServices.find((b) => b.branchId === branchId);
      return { branchId, offered: row?.active ?? false, priceCentsOverride: num(row?.priceCentsOverride) };
    }),
  };
}

export async function listServices(
  deps: CoreDeps,
  p: StaffPrincipal,
  options: { includeArchived?: boolean } = {},
): Promise<ServiceDto[]> {
  requirePermission(p, 'catalog:read');
  const services = await deps.db.service.findMany({
    where: { organizationId: p.organizationId, ...(options.includeArchived ? {} : { archivedAt: null }) },
    include: serviceInclude,
    orderBy: [{ category: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
  return services.map((s) => toServiceDto(s, p.branchIds));
}

async function loadService(deps: CoreDeps, p: StaffPrincipal, serviceId: string): Promise<ServiceRow> {
  const service = await deps.db.service.findFirst({
    where: { id: serviceId, organizationId: p.organizationId },
    include: serviceInclude,
  });
  if (!service) throw Errors.notFound('No encontramos ese servicio.');
  return service;
}

/** Crea el servicio y lo ofrece en todas las sucursales activas (cada una puede después quitarlo). */
export async function createService(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: CreateServiceBody,
): Promise<ServiceDto> {
  requirePermission(p, 'catalog:manage');
  const body = createServiceBody.parse(rawBody);
  const id = await deps.db.$transaction(async (tx) => {
    await assertCategory(tx, p, 'service', body.categoryId);
    const branches = await tx.branch.findMany({
      where: { organizationId: p.organizationId, active: true },
      select: { id: true },
    });
    const service = await tx.service.create({
      data: {
        organizationId: p.organizationId,
        categoryId: body.categoryId,
        name: body.name,
        description: body.description,
        durationMin: body.durationMin,
        basePriceCents: BigInt(body.basePriceCents),
        active: body.active,
        onlineBookable: body.onlineBookable,
        pointsOverride: body.pointsOverride,
        commissionBpsOverride: body.commissionBpsOverride,
        depositMode: body.depositMode,
        depositFixedCents: body.depositMode === 'FIXED' ? big(body.depositFixedCents) : null,
        depositPercentBps: body.depositMode === 'PERCENT' ? body.depositPercentBps : null,
        sortOrder: body.sortOrder,
        branchServices: { create: branches.map((b) => ({ branchId: b.id })) },
      },
    });
    return service.id;
  });
  return toServiceDto(await loadService(deps, p, id), p.branchIds);
}

export async function updateService(
  deps: CoreDeps,
  p: StaffPrincipal,
  serviceId: string,
  rawBody: UpdateServiceBody,
  meta: RequestMeta,
): Promise<ServiceDto> {
  requirePermission(p, 'catalog:manage');
  const body = updateServiceBody.parse(rawBody);
  const current = await loadService(deps, p, serviceId);

  const depositMode = body.depositMode ?? current.depositMode;
  const deposit = {
    depositMode,
    depositFixedCents:
      depositMode === 'FIXED' ? (body.depositFixedCents ?? num(current.depositFixedCents)) : null,
    depositPercentBps:
      depositMode === 'PERCENT' ? (body.depositPercentBps ?? current.depositPercentBps) : null,
  };
  const problem = depositProblem(deposit);
  if (problem) throw Errors.invalid(problem);

  await deps.db.$transaction(async (tx) => {
    await assertCategory(tx, p, 'service', body.categoryId);
    const {
      archived,
      basePriceCents,
      depositFixedCents: _f,
      depositPercentBps: _p,
      depositMode: _m,
      ...rest
    } = body;
    await tx.service.update({
      where: { id: serviceId },
      data: {
        ...rest,
        ...(basePriceCents !== undefined ? { basePriceCents: BigInt(basePriceCents) } : {}),
        depositMode: deposit.depositMode,
        depositFixedCents: big(deposit.depositFixedCents),
        depositPercentBps: deposit.depositPercentBps,
        ...(archived === undefined
          ? {}
          : archived
            ? { archivedAt: new Date(), active: false }
            : { archivedAt: null }),
      },
    });
    if (basePriceCents !== undefined && BigInt(basePriceCents) !== current.basePriceCents) {
      await writeAudit(tx, {
        organizationId: p.organizationId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'SERVICE_PRICE_CHANGED',
        entityType: 'Service',
        entityId: serviceId,
        summary: `Precio base de "${current.name}"`,
        before: { basePriceCents: Number(current.basePriceCents) },
        after: { basePriceCents },
        meta,
      });
    }
    if (
      body.commissionBpsOverride !== undefined &&
      body.commissionBpsOverride !== current.commissionBpsOverride
    ) {
      await writeAudit(tx, {
        organizationId: p.organizationId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'COMMISSION_RATE_CHANGED',
        entityType: 'Service',
        entityId: serviceId,
        summary: `Comisión específica de "${current.name}"`,
        before: { commissionBpsOverride: current.commissionBpsOverride },
        after: { commissionBpsOverride: body.commissionBpsOverride },
        meta,
      });
    }
  });
  return toServiceDto(await loadService(deps, p, serviceId), p.branchIds);
}

/** Si una sucursal ofrece el servicio y con qué precio propio (null = precio base). */
export async function setBranchService(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  serviceId: string,
  rawBody: z.input<typeof setBranchServiceBody>,
  meta: RequestMeta,
): Promise<ServiceDto> {
  requirePermission(p, 'catalog:branch-prices');
  requireBranchAccess(p, branchId);
  const body = setBranchServiceBody.parse(rawBody);
  const service = await loadService(deps, p, serviceId);
  const before = service.branchServices.find((b) => b.branchId === branchId);
  const price = big(body.priceCentsOverride);

  await deps.db.$transaction(async (tx) => {
    await tx.branchService.upsert({
      where: { branchId_serviceId: { branchId, serviceId } },
      create: { branchId, serviceId, active: body.offered, priceCentsOverride: price },
      update: { active: body.offered, priceCentsOverride: price },
    });
    if ((before?.priceCentsOverride ?? null) !== price) {
      await writeAudit(tx, {
        organizationId: p.organizationId,
        branchId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'SERVICE_PRICE_CHANGED',
        entityType: 'BranchService',
        entityId: serviceId,
        summary: `Precio de "${service.name}" en la sucursal`,
        before: { priceCentsOverride: num(before?.priceCentsOverride) },
        after: { priceCentsOverride: body.priceCentsOverride },
        meta,
      });
    }
  });
  return toServiceDto(await loadService(deps, p, serviceId), p.branchIds);
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

const productInclude = { category: true, branchProducts: true } as const;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

function toProductDto(x: ProductRow, visibleBranchIds: string[]): ProductDto {
  return {
    id: x.id,
    categoryId: x.categoryId,
    categoryName: x.category?.name ?? null,
    name: x.name,
    description: x.description,
    sku: x.sku,
    barcode: x.barcode,
    basePriceCents: Number(x.basePriceCents),
    costCents: num(x.costCents),
    trackStock: x.trackStock,
    active: x.active,
    pointsOverride: x.pointsOverride,
    commissionBpsOverride: x.commissionBpsOverride,
    archived: Boolean(x.archivedAt),
    branches: visibleBranchIds.map((branchId) => {
      const row = x.branchProducts.find((b) => b.branchId === branchId);
      return { branchId, offered: row?.active ?? false, priceCentsOverride: num(row?.priceCentsOverride) };
    }),
  };
}

export async function listProducts(
  deps: CoreDeps,
  p: StaffPrincipal,
  options: { includeArchived?: boolean } = {},
): Promise<ProductDto[]> {
  requirePermission(p, 'catalog:read');
  const rows = await deps.db.product.findMany({
    where: { organizationId: p.organizationId, ...(options.includeArchived ? {} : { archivedAt: null }) },
    include: productInclude,
    orderBy: [{ name: 'asc' }],
  });
  return rows.map((x) => toProductDto(x, p.branchIds));
}

async function loadProduct(deps: CoreDeps, p: StaffPrincipal, productId: string): Promise<ProductRow> {
  const product = await deps.db.product.findFirst({
    where: { id: productId, organizationId: p.organizationId },
    include: productInclude,
  });
  if (!product) throw Errors.notFound('No encontramos ese producto.');
  return product;
}

function productUniqueError(error: unknown): never {
  if (isUniqueViolation(error))
    throw Errors.conflict('Ya hay un producto con ese código (SKU o código de barras).');
  throw error;
}

export async function createProduct(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: CreateProductBody,
): Promise<ProductDto> {
  requirePermission(p, 'catalog:manage');
  const body = createProductBody.parse(rawBody);
  const id = await deps.db
    .$transaction(async (tx) => {
      await assertCategory(tx, p, 'product', body.categoryId);
      const branches = await tx.branch.findMany({
        where: { organizationId: p.organizationId, active: true },
        select: { id: true },
      });
      const product = await tx.product.create({
        data: {
          organizationId: p.organizationId,
          categoryId: body.categoryId,
          name: body.name,
          description: body.description,
          sku: body.sku,
          barcode: body.barcode,
          basePriceCents: BigInt(body.basePriceCents),
          costCents: big(body.costCents),
          trackStock: body.trackStock,
          active: body.active,
          pointsOverride: body.pointsOverride,
          commissionBpsOverride: body.commissionBpsOverride,
          branchProducts: { create: branches.map((b) => ({ branchId: b.id })) },
        },
      });
      return product.id;
    })
    .catch(productUniqueError);
  return toProductDto(await loadProduct(deps, p, id), p.branchIds);
}

export async function updateProduct(
  deps: CoreDeps,
  p: StaffPrincipal,
  productId: string,
  rawBody: UpdateProductBody,
  meta: RequestMeta,
): Promise<ProductDto> {
  requirePermission(p, 'catalog:manage');
  const body = updateProductBody.parse(rawBody);
  const current = await loadProduct(deps, p, productId);
  await deps.db
    .$transaction(async (tx) => {
      await assertCategory(tx, p, 'product', body.categoryId);
      const { archived, basePriceCents, costCents, ...rest } = body;
      await tx.product.update({
        where: { id: productId },
        data: {
          ...rest,
          ...(basePriceCents !== undefined ? { basePriceCents: BigInt(basePriceCents) } : {}),
          ...(costCents !== undefined ? { costCents: big(costCents) } : {}),
          ...(archived === undefined
            ? {}
            : archived
              ? { archivedAt: new Date(), active: false }
              : { archivedAt: null }),
        },
      });
      if (basePriceCents !== undefined && BigInt(basePriceCents) !== current.basePriceCents) {
        await writeAudit(tx, {
          organizationId: p.organizationId,
          actor: { type: 'STAFF', userId: p.userId },
          action: 'PRODUCT_PRICE_CHANGED',
          entityType: 'Product',
          entityId: productId,
          summary: `Precio de "${current.name}"`,
          before: { basePriceCents: Number(current.basePriceCents) },
          after: { basePriceCents },
          meta,
        });
      }
    })
    .catch(productUniqueError);
  return toProductDto(await loadProduct(deps, p, productId), p.branchIds);
}

export async function setBranchProduct(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  productId: string,
  rawBody: z.input<typeof setBranchProductBody>,
  meta: RequestMeta,
): Promise<ProductDto> {
  requirePermission(p, 'catalog:branch-prices');
  requireBranchAccess(p, branchId);
  const body = setBranchProductBody.parse(rawBody);
  const product = await loadProduct(deps, p, productId);
  const before = product.branchProducts.find((b) => b.branchId === branchId);
  const price = big(body.priceCentsOverride);
  await deps.db.$transaction(async (tx) => {
    await tx.branchProduct.upsert({
      where: { branchId_productId: { branchId, productId } },
      create: { branchId, productId, active: body.offered, priceCentsOverride: price },
      update: { active: body.offered, priceCentsOverride: price },
    });
    if ((before?.priceCentsOverride ?? null) !== price) {
      await writeAudit(tx, {
        organizationId: p.organizationId,
        branchId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'PRODUCT_PRICE_CHANGED',
        entityType: 'BranchProduct',
        entityId: productId,
        summary: `Precio de "${product.name}" en la sucursal`,
        before: { priceCentsOverride: num(before?.priceCentsOverride) },
        after: { priceCentsOverride: body.priceCentsOverride },
        meta,
      });
    }
  });
  return toProductDto(await loadProduct(deps, p, productId), p.branchIds);
}

// ---------------------------------------------------------------------------
// Aumento masivo de precios
// ---------------------------------------------------------------------------

/**
 * Aplica un porcentaje (con redondeo) a los precios base y, opcionalmente, a los precios propios
 * de cada sucursal. Todo en una transacción y con una fila de auditoría por ítem.
 */
export async function bulkUpdatePrices(
  deps: CoreDeps,
  p: StaffPrincipal,
  kind: CategoryKind,
  rawBody: BulkPriceBody,
  meta: RequestMeta,
): Promise<BulkPriceResult> {
  requirePermission(p, 'catalog:manage');
  const body = bulkPriceBody.parse(rawBody);
  const change = (cents: bigint) =>
    BigInt(applyPercentChange(Number(cents), body.percentBps, body.roundToCents));
  const where = {
    organizationId: p.organizationId,
    archivedAt: null,
    ...(body.ids.length ? { id: { in: body.ids } } : { active: true }),
  };

  return deps.db.$transaction(async (tx) => {
    const items =
      kind === 'service'
        ? (await tx.service.findMany({ where, include: { branchServices: true } })).map((s) => ({
            id: s.id,
            name: s.name,
            base: s.basePriceCents,
            overrides: s.branchServices.filter((b) => b.priceCentsOverride !== null),
          }))
        : (await tx.product.findMany({ where, include: { branchProducts: true } })).map((x) => ({
            id: x.id,
            name: x.name,
            base: x.basePriceCents,
            overrides: x.branchProducts.filter((b) => b.priceCentsOverride !== null),
          }));

    const changes: BulkPriceResult['changes'] = [];
    for (const item of items) {
      const after = change(item.base);
      if (kind === 'service') {
        await tx.service.update({ where: { id: item.id }, data: { basePriceCents: after } });
      } else {
        await tx.product.update({ where: { id: item.id }, data: { basePriceCents: after } });
      }
      const branchChanges: { branchId: string; before: number; after: number }[] = [];
      if (body.includeBranchPrices) {
        for (const o of item.overrides) {
          const next = change(o.priceCentsOverride!);
          branchChanges.push({
            branchId: o.branchId,
            before: Number(o.priceCentsOverride),
            after: Number(next),
          });
          if (kind === 'service') {
            await tx.branchService.update({
              where: { branchId_serviceId: { branchId: o.branchId, serviceId: item.id } },
              data: { priceCentsOverride: next },
            });
          } else {
            await tx.branchProduct.update({
              where: { branchId_productId: { branchId: o.branchId, productId: item.id } },
              data: { priceCentsOverride: next },
            });
          }
        }
      }
      await writeAudit(tx, {
        organizationId: p.organizationId,
        actor: { type: 'STAFF', userId: p.userId },
        action: kind === 'service' ? 'SERVICE_PRICE_CHANGED' : 'PRODUCT_PRICE_CHANGED',
        entityType: kind === 'service' ? 'Service' : 'Product',
        entityId: item.id,
        summary: `Aumento masivo ${body.percentBps / 100} % (redondeo $${body.roundToCents / 100})`,
        before: { basePriceCents: Number(item.base) },
        after: { basePriceCents: Number(after), branchPrices: branchChanges },
        meta,
      });
      changes.push({ id: item.id, name: item.name, before: Number(item.base), after: Number(after) });
    }
    return { updated: changes.length, changes };
  });
}
