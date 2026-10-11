import 'server-only';
import type { StaffMe } from '@estoicos/shared';
import { cookies } from 'next/headers';
import { BRANCH_COOKIE } from './session-cookies';

/** Sucursal elegida en el selector del sidebar (o la primera permitida). */
export async function currentBranch(me: StaffMe) {
  const chosen = (await cookies()).get(BRANCH_COOKIE)?.value;
  return me.branches.find((b) => b.id === chosen) ?? me.branches[0] ?? null;
}
