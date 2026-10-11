import type { Db } from '@estoicos/db';
import type { BranchSummary } from '@estoicos/shared';
import type { StaffPrincipal } from '../../authz/principal';
import { Errors } from '../../errors';

export interface OrganizationRef {
  id: string;
  name: string;
  slug: string;
}

/** En la v1 hay una sola organización (DEFAULT_ORGANIZATION_SLUG); a futuro se resuelve por dominio. */
export async function getOrganizationBySlug(db: Db, slug: string): Promise<OrganizationRef> {
  const org = await db.organization.findUnique({
    where: { slug },
    select: { id: true, name: true, slug: true },
  });
  if (!org) throw Errors.notFound(`No existe la organización "${slug}". ¿Corriste el seed?`);
  return org;
}

/** Sucursales a las que el staff tiene acceso (para el selector de sucursal). */
export async function listBranchesForPrincipal(db: Db, principal: StaffPrincipal): Promise<BranchSummary[]> {
  return db.branch.findMany({
    where: { organizationId: principal.organizationId, id: { in: principal.branchIds }, active: true },
    select: { id: true, name: true, slug: true },
    orderBy: { name: 'asc' },
  });
}
