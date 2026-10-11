import type { Branch } from '@estoicos/db';
import {
  createBranchBody,
  createClosureBody,
  updateBranchBody,
  type BranchDetail,
  type ClosureDto,
  type CreateBranchBody,
  type UpdateBranchBody,
} from '@estoicos/shared';
import type { z } from 'zod';
import { requireBranchAccess, requirePermission, type StaffPrincipal } from '../../authz/principal';
import type { CoreDeps, RequestMeta } from '../../deps';
import { Errors, isUniqueViolation } from '../../errors';
import { localDayRange } from '../../time';
import { writeAudit } from '../audit/audit';

function toBranchDetail(b: Branch): BranchDetail {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    address: b.address,
    city: b.city,
    province: b.province,
    phone: b.phone,
    email: b.email,
    timezone: b.timezone,
    googleReviewUrl: b.googleReviewUrl,
    bookingEnabled: b.bookingEnabled,
    active: b.active,
  };
}

/** Sucursales con sus datos. El dueño ve también las inactivas. */
export async function listBranchDetails(deps: CoreDeps, p: StaffPrincipal): Promise<BranchDetail[]> {
  requirePermission(p, 'branch:read');
  const rows = await deps.db.branch.findMany({
    where:
      p.accessLevel === 'OWNER'
        ? { organizationId: p.organizationId }
        : { organizationId: p.organizationId, id: { in: p.branchIds } },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
  });
  return rows.map(toBranchDetail);
}

function slugConflict(error: unknown): never {
  if (isUniqueViolation(error)) throw Errors.conflict('Ya hay una sucursal con ese link. Elegí otro.');
  throw error;
}

/** Nueva sucursal: ofrece todos los servicios y productos activos (cada uno se puede quitar después). */
export async function createBranch(
  deps: CoreDeps,
  p: StaffPrincipal,
  rawBody: CreateBranchBody,
  meta: RequestMeta,
): Promise<BranchDetail> {
  requirePermission(p, 'branches:manage');
  const body = createBranchBody.parse(rawBody);
  const org = await deps.db.organization.findUniqueOrThrow({ where: { id: p.organizationId } });
  const branch = await deps.db
    .$transaction(async (tx) => {
      const created = await tx.branch.create({
        data: { organizationId: p.organizationId, timezone: org.timezone, ...body },
      });
      const [services, products] = await Promise.all([
        tx.service.findMany({
          where: { organizationId: p.organizationId, archivedAt: null },
          select: { id: true },
        }),
        tx.product.findMany({
          where: { organizationId: p.organizationId, archivedAt: null },
          select: { id: true },
        }),
      ]);
      await tx.branchService.createMany({
        data: services.map((s) => ({ branchId: created.id, serviceId: s.id })),
      });
      await tx.branchProduct.createMany({
        data: products.map((x) => ({ branchId: created.id, productId: x.id })),
      });
      await writeAudit(tx, {
        organizationId: p.organizationId,
        branchId: created.id,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'SETTINGS_CHANGED',
        entityType: 'Branch',
        entityId: created.id,
        summary: `Alta de la sucursal ${created.name}`,
        after: body,
        meta,
      });
      return created;
    })
    .catch(slugConflict);
  return toBranchDetail(branch);
}

export async function updateBranch(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  rawBody: UpdateBranchBody,
  meta: RequestMeta,
): Promise<BranchDetail> {
  requirePermission(p, 'branches:manage');
  const body = updateBranchBody.parse(rawBody);
  const current = await deps.db.branch.findFirst({
    where: { id: branchId, organizationId: p.organizationId },
  });
  if (!current) throw Errors.notFound('No encontramos esa sucursal.');
  if (body.active === false) {
    const others = await deps.db.branch.count({
      where: { organizationId: p.organizationId, active: true, id: { not: branchId } },
    });
    if (others === 0) throw Errors.conflict('Tiene que quedar al menos una sucursal activa.');
  }
  const updated = await deps.db
    .$transaction(async (tx) => {
      const branch = await tx.branch.update({ where: { id: branchId }, data: body });
      await writeAudit(tx, {
        organizationId: p.organizationId,
        branchId,
        actor: { type: 'STAFF', userId: p.userId },
        action: 'SETTINGS_CHANGED',
        entityType: 'Branch',
        entityId: branchId,
        summary: `Datos de la sucursal ${current.name}`,
        before: toBranchDetail(current),
        after: body,
        meta,
      });
      return branch;
    })
    .catch(slugConflict);
  return toBranchDetail(updated);
}

// ---------------------------------------------------------------------------
// Cierres de sucursal (feriados)
// ---------------------------------------------------------------------------

export async function listClosures(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
): Promise<ClosureDto[]> {
  requirePermission(p, 'branch:read');
  requireBranchAccess(p, branchId);
  const rows = await deps.db.branchClosure.findMany({
    where: { branchId, endsAt: { gte: deps.now() } },
    orderBy: { startsAt: 'asc' },
  });
  return rows.map((c) => ({
    id: c.id,
    startsAt: c.startsAt.toISOString(),
    endsAt: c.endsAt.toISOString(),
    reason: c.reason,
  }));
}

export async function createClosure(
  deps: CoreDeps,
  p: StaffPrincipal,
  branchId: string,
  rawBody: z.input<typeof createClosureBody>,
): Promise<ClosureDto[]> {
  requirePermission(p, 'closures:manage');
  requireBranchAccess(p, branchId);
  const body = createClosureBody.parse(rawBody);
  const branch = await deps.db.branch.findFirstOrThrow({
    where: { id: branchId, organizationId: p.organizationId },
  });
  const range = localDayRange(body.date, body.endDate, branch.timezone);
  if (!range) throw Errors.invalid('La fecha de fin tiene que ser igual o posterior a la de inicio.');
  await deps.db.branchClosure.create({
    data: {
      branchId,
      startsAt: range.startsAt,
      endsAt: range.endsAt,
      reason: body.reason,
      createdById: p.userId,
    },
  });
  return listClosures(deps, p, branchId);
}

export async function deleteClosure(deps: CoreDeps, p: StaffPrincipal, branchId: string, closureId: string) {
  requirePermission(p, 'closures:manage');
  requireBranchAccess(p, branchId);
  const result = await deps.db.branchClosure.deleteMany({ where: { id: closureId, branchId } });
  if (result.count === 0) throw Errors.notFound('No encontramos ese cierre.');
  return listClosures(deps, p, branchId);
}
