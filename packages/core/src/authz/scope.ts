import { Errors } from '../errors';
import type { StaffPrincipal } from './principal';

/** Todas las sucursales indicadas tienen que estar entre las permitidas del usuario. */
export function requireBranchesAccess(principal: StaffPrincipal, branchIds: string[]): void {
  const outside = branchIds.filter((id) => !principal.branchIds.includes(id));
  if (outside.length > 0) throw Errors.forbidden('No tenés acceso a alguna de las sucursales elegidas.');
}

/** Solo el dueño gestiona algo que abarca sucursales fuera de su alcance. */
export function canManageAcross(principal: StaffPrincipal, branchIds: string[]): boolean {
  return principal.accessLevel === 'OWNER' || branchIds.every((id) => principal.branchIds.includes(id));
}
