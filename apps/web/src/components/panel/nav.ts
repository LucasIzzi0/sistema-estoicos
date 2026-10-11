import type { Permission, StaffMe } from '@estoicos/shared';

export type NavIcon =
  | 'dashboard'
  | 'agenda'
  | 'cash'
  | 'customers'
  | 'services'
  | 'products'
  | 'team'
  | 'mercadopago'
  | 'loyalty'
  | 'notifications'
  | 'reports'
  | 'settings';

export interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  /** Permiso necesario para verlo (la API lo exige igual). */
  permission: Permission;
}

/**
 * Sidebar del panel, en el orden pedido. Los barberos no usan el sistema (decisión del
 * 25/09/2026): el panel es para dueño, encargado y, a futuro, recepción.
 */
export const ADMIN_NAV: NavItem[] = [
  { href: '/admin/dashboard', label: 'Dashboard', icon: 'dashboard', permission: 'dashboard:view' },
  { href: '/admin/agenda', label: 'Agenda', icon: 'agenda', permission: 'agenda:read' },
  { href: '/admin/caja', label: 'Caja y Ventas', icon: 'cash', permission: 'sales:charge' },
  { href: '/admin/clientes', label: 'Clientes', icon: 'customers', permission: 'customers:read' },
  { href: '/admin/servicios', label: 'Servicios', icon: 'services', permission: 'catalog:read' },
  { href: '/admin/productos', label: 'Productos y Stock', icon: 'products', permission: 'catalog:read' },
  { href: '/admin/barberos', label: 'Barberos y Comisiones', icon: 'team', permission: 'barbers:read' },
  {
    href: '/admin/pagos-mp',
    label: 'Pagos Mercado Pago',
    icon: 'mercadopago',
    permission: 'mercadopago:reconcile',
  },
  { href: '/admin/puntos', label: 'Puntos y Recompensas', icon: 'loyalty', permission: 'loyalty:adjust' },
  {
    href: '/admin/notificaciones',
    label: 'Notificaciones',
    icon: 'notifications',
    permission: 'notifications:settings',
  },
  { href: '/admin/reportes', label: 'Reportes', icon: 'reports', permission: 'reports:view' },
  { href: '/admin/configuracion', label: 'Configuración', icon: 'settings', permission: 'staff:read' },
];

export function visibleNav(items: NavItem[], me: StaffMe): NavItem[] {
  return items.filter((item) => me.permissions.includes(item.permission));
}

export function can(me: StaffMe, permission: Permission): boolean {
  return me.permissions.includes(permission);
}
