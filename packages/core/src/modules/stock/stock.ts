import {
  minStockBody,
  stockAdjustBody,
  stockPurchaseBody,
  type StockAdjustBody,
  type StockItem,
  type StockMovementDto,
  type StockPurchaseBody,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors } from '../../errors';
import { writeAudit } from '../audit/audit';
import { changeStock } from '../sales/sales';

/**
 * Stock por sucursal. La verdad es el ledger inmutable (stock_movements); el saldo de
 * branch_products se actualiza en la misma transacción con un UPDATE atómico. Se puede vender
 * sin stock (P24) y queda la alerta.
 */
export async function listStock(deps: CoreDeps, p: StaffPrincipal, branchId: string): Promise<StockItem[]> {
  requirePermission(p, 'catalog:read');
  requireBranchAccess(p, branchId);
  const products = await deps.db.product.findMany({
    where: { organizationId: p.organizationId, active: true, archivedAt: null, trackStock: true },
    include: { category: { select: { name: true } }, branchProducts: { where: { branchId } } },
    orderBy: { name: 'asc' },
  });
  return products
    .filter((pr) => pr.branchProducts[0]?.active !== false)
    .map((pr) => {
      const bp = pr.branchProducts[0];
      const stock = bp?.stockOnHand ?? 0;
      const min = bp?.minStock ?? null;
      return {
        productId: pr.id,
        name: pr.name,
        sku: pr.sku,
        categoryName: pr.category?.name ?? null,
        stockOnHand: stock,
        minStock: min,
        low: stock < 0 || (min !== null && stock <= min),
        priceCents: Number(bp?.priceCentsOverride ?? pr.basePriceCents),
        costCents: pr.costCents === null ? null : Number(pr.costCents),
      };
    });
}

async function loadProduct(deps: CoreDeps, p: StaffPrincipal, branchId: string, productId: string) {
  requirePermission(p, 'stock:adjust');
  requireBranchAccess(p, branchId);
  const product = await deps.db.product.findFirst({
    where: { id: productId, organizationId: p.organizationId, archivedAt: null },
  });
  if (!product) throw Errors.notFound('No encontramos ese producto.');
  if (!product.trackStock) throw Errors.invalid('Ese producto no lleva control de stock.');
  return product;
}

/** Compra (entra mercadería). Si se indica el costo, actualiza el costo del producto. */
export async function recordStockPurchase(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  productId: string,
  rawBody: StockPurchaseBody,
  meta: RequestMeta,
): Promise<StockItem[]> {
  const product = await loadProduct(deps, p, branchId, productId);
  const body = stockPurchaseBody.parse(rawBody);
  await deps.db.$transaction(async (tx) => {
    const balance = await changeStock(tx, branchId, productId, body.quantity);
    const unitCost =
      body.unitCostCents === null || body.unitCostCents === undefined ? null : BigInt(body.unitCostCents);
    await tx.stockMovement.create({
      data: {
        organizationId: p.organizationId,
        branchId,
        productId,
        type: 'PURCHASE',
        quantity: body.quantity,
        balanceAfter: balance.stockOnHand,
        unitCostCents: unitCost,
        reason: body.note,
        createdById: p.userId,
      },
    });
    if (unitCost !== null && unitCost !== product.costCents) {
      await tx.product.update({ where: { id: productId }, data: { costCents: unitCost } });
    }
    await writeAudit(tx, {
      organizationId: p.organizationId,
      branchId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'STOCK_PURCHASE_RECORDED',
      entityType: 'Product',
      entityId: productId,
      summary: `Compra de ${body.quantity} × ${product.name}`,
      after: {
        quantity: body.quantity,
        stockOnHand: balance.stockOnHand,
        unitCostCents: body.unitCostCents ?? null,
      },
      meta,
    });
  });
  return listStock(deps, p, branchId);
}

/** Ajuste con motivo obligatorio (la base lo exige): recuento, rotura, uso interno. */
export async function adjustStock(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  productId: string,
  rawBody: StockAdjustBody,
  meta: RequestMeta,
): Promise<StockItem[]> {
  const product = await loadProduct(deps, p, branchId, productId);
  const body = stockAdjustBody.parse(rawBody);
  const delta = body.type === 'ADJUSTMENT_IN' ? body.quantity : -body.quantity;
  await deps.db.$transaction(async (tx) => {
    const balance = await changeStock(tx, branchId, productId, delta);
    await tx.stockMovement.create({
      data: {
        organizationId: p.organizationId,
        branchId,
        productId,
        type: body.type,
        quantity: delta,
        balanceAfter: balance.stockOnHand,
        reason: body.reason,
        createdById: p.userId,
      },
    });
    await writeAudit(tx, {
      organizationId: p.organizationId,
      branchId,
      actor: { type: 'STAFF', userId: p.userId },
      action: 'STOCK_ADJUSTED',
      entityType: 'Product',
      entityId: productId,
      summary: `${product.name}: ${delta > 0 ? '+' : ''}${delta}`,
      after: { quantity: delta, stockOnHand: balance.stockOnHand },
      reason: body.reason,
      meta,
    });
  });
  return listStock(deps, p, branchId);
}

export async function setMinStock(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  productId: string,
  rawBody: z.input<typeof minStockBody>,
): Promise<StockItem[]> {
  await loadProduct(deps, p, branchId, productId);
  const body = minStockBody.parse(rawBody);
  await deps.db.branchProduct.upsert({
    where: { branchId_productId: { branchId, productId } },
    create: { branchId, productId, minStock: body.minStock },
    update: { minStock: body.minStock },
  });
  return listStock(deps, p, branchId);
}

export async function listStockMovements(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  productId: string,
): Promise<StockMovementDto[]> {
  requirePermission(p, 'catalog:read');
  requireBranchAccess(p, branchId);
  const rows = await deps.db.stockMovement.findMany({
    where: { branchId, productId, organizationId: p.organizationId },
    include: {
      createdBy: { select: { name: true } },
      saleItem: { select: { sale: { select: { number: true } } } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((m) => ({
    id: m.id,
    type: m.type,
    quantity: m.quantity,
    balanceAfter: m.balanceAfter,
    reason: m.reason,
    saleNumber: m.saleItem?.sale.number ?? null,
    createdByName: m.createdBy?.name ?? null,
    createdAt: m.createdAt.toISOString(),
  }));
}
