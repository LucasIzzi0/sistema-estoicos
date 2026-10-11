import { requireBranchAccess, type StaffPrincipal } from '../../authz/principal';

/**
 * Filtro de sucursal para cualquier consulta de números. Sin sucursal elegida, el dueño ve todo
 * y el encargado solo las suyas: nunca se muestra plata de una sucursal que no le corresponde.
 */
export function branchScope(
  p: StaffPrincipal,
  branchId: string | undefined,
): { branchId?: string | { in: string[] } } {
  if (branchId) {
    requireBranchAccess(p, branchId);
    return { branchId };
  }
  return p.accessLevel === 'OWNER' ? {} : { branchId: { in: p.branchIds } };
}
