/**
 * Matriz de permisos. La API la usa para AUTORIZAR; la web solo para mostrar u ocultar opciones.
 *
 * Decisión del 25/09/2026: los barberos NO son usuarios del sistema. Los usuarios son:
 *  - OWNER: ADMIN con acceso a todas las sucursales (dueño).
 *  - BRANCH_ADMIN: ADMIN limitado a sus sucursales (encargado).
 *  - RECEPTION: recepcionista de sus sucursales (agenda, clientes y cobro; sin finanzas ni configuración).
 * Además del permiso, toda acción con sucursal exige acceso a ESA sucursal.
 */
export const STAFF_ROLES = ['ADMIN', 'RECEPTION'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

export const ACCESS_LEVELS = ['OWNER', 'BRANCH_ADMIN', 'RECEPTION'] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];

export function accessLevelOf(role: StaffRole, allBranches: boolean): AccessLevel {
  if (role === 'RECEPTION') return 'RECEPTION';
  return allBranches ? 'OWNER' : 'BRANCH_ADMIN';
}

const OWNER_ONLY = ['OWNER'] as const;
const ADMINS = ['OWNER', 'BRANCH_ADMIN'] as const;
/** Quienes atienden el local: agenda, clientes y cobro. */
const FRONT_DESK = ['OWNER', 'BRANCH_ADMIN', 'RECEPTION'] as const;

export const PERMISSIONS = {
  // Estructura y equipo (usuarios del sistema)
  'branch:read': FRONT_DESK,
  'branches:manage': OWNER_ONLY,
  'dashboard:view': ADMINS,
  'staff:read': ADMINS,
  'staff:invite': ADMINS,
  'staff:update': ADMINS,
  'org:settings': OWNER_ONLY,
  'system:health': ADMINS,
  'system:alerts:ack': ADMINS,
  // Catálogo
  'catalog:read': FRONT_DESK,
  'catalog:manage': OWNER_ONLY,
  'catalog:branch-prices': ADMINS,
  // Barberos (perfiles, horarios, bloqueos) y cierres de sucursal
  'barbers:read': FRONT_DESK,
  'barbers:manage': ADMINS,
  'closures:manage': ADMINS,
  // Agenda
  'agenda:read': FRONT_DESK,
  'appointments:manage': FRONT_DESK,
  // Ventas, caja y stock
  'sales:charge': FRONT_DESK,
  'sales:discount': ADMINS,
  'sales:void': ADMINS,
  'cash:open': FRONT_DESK,
  'cash:close': ADMINS,
  'expenses:manage': ADMINS,
  'stock:adjust': ADMINS,
  // Clientes
  'customers:read': FRONT_DESK,
  'customers:create': FRONT_DESK,
  'customers:update': FRONT_DESK,
  'customers:merge': ADMINS,
  // Comisiones
  'commissions:read': ADMINS,
  'commissions:settle': ADMINS,
  // Puntos, notificaciones, Mercado Pago, reportes
  'loyalty:settings': OWNER_ONLY,
  'loyalty:adjust': ADMINS,
  'notifications:settings': OWNER_ONLY,
  'mercadopago:connect': OWNER_ONLY,
  'mercadopago:reconcile': ADMINS,
  // Devolver plata de un cobro: solo el dueño (decisión del 28/09/2026).
  'payments:refund': OWNER_ONLY,
  'reports:view': ADMINS,
  // Bajar planillas con datos de clientes: solo el dueño (decisión del 28/09/2026).
  'reports:export': OWNER_ONLY,
} as const satisfies Record<string, readonly AccessLevel[]>;

export type Permission = keyof typeof PERMISSIONS;

export function hasPermission(level: AccessLevel, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly AccessLevel[]).includes(level);
}
