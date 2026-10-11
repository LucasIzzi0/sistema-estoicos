import type { StaffMe } from '@estoicos/shared';

/** Solo redirecciones internas: evita que ?next= mande al usuario a otro sitio. */
export function safeNext(value: string | null | undefined, fallback: string): string {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : fallback;
}

/** Pantalla de inicio según el nivel de acceso (recepción no ve el dashboard). */
export function staffHome(me: Pick<StaffMe, 'accessLevel'>): string {
  return me.accessLevel === 'RECEPTION' ? '/admin/clientes' : '/admin/dashboard';
}
