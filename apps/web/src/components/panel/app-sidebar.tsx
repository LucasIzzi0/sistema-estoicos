'use client';

import type { BranchSummary, StaffMe } from '@estoicos/shared';
import {
  Bell,
  CalendarDays,
  ChartColumn,
  Check,
  ChevronsUpDown,
  CreditCard,
  Gift,
  LayoutDashboard,
  LogOut,
  Monitor,
  Moon,
  Package,
  Receipt,
  Scissors,
  Settings,
  Store,
  Sun,
  UserCog,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Wordmark } from '@/components/brand';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from '@/components/ui/sidebar';
import { api } from '@/lib/api/client';
import { BRANCH_COOKIE } from '@/lib/session-cookies';
import type { NavIcon, NavItem } from './nav';

const ICONS: Record<NavIcon, LucideIcon> = {
  dashboard: LayoutDashboard,
  agenda: CalendarDays,
  cash: Receipt,
  customers: Users,
  services: Scissors,
  products: Package,
  team: UserCog,
  mercadopago: CreditCard,
  loyalty: Gift,
  notifications: Bell,
  reports: ChartColumn,
  settings: Settings,
};

const ROLE_LABEL: Record<StaffMe['accessLevel'], string> = {
  OWNER: 'Dueño',
  BRANCH_ADMIN: 'Encargado',
  RECEPTION: 'Recepción',
};

export function AppSidebar(props: { me: StaffMe; nav: NavItem[]; currentBranch: BranchSummary | null }) {
  const { me, nav, currentBranch } = props;
  const pathname = usePathname();
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const { theme, setTheme } = useTheme();

  function chooseBranch(branchId: string) {
    document.cookie = `${BRANCH_COOKIE}=${branchId}; path=/; max-age=31536000; samesite=lax`;
    router.refresh();
  }

  async function logout() {
    await api('/v1/auth/staff/logout', { method: 'POST', body: {} }).catch(() => undefined);
    router.replace('/staff/ingresar');
    router.refresh();
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-9 items-center px-2 group-data-[collapsible=icon]:hidden">
          <Wordmark />
        </div>
        {currentBranch && (
          <SidebarMenu>
            <SidebarMenuItem>
              {me.branches.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <SidebarMenuButton
                      size="lg"
                      tooltip={currentBranch.name}
                      className="border bg-background"
                    >
                      <Store />
                      <div className="grid flex-1 text-left leading-tight">
                        <span className="text-xs text-muted-foreground">Sucursal</span>
                        <span className="truncate font-medium">{currentBranch.name}</span>
                      </div>
                      <ChevronsUpDown className="ml-auto" />
                    </SidebarMenuButton>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
                  >
                    <DropdownMenuLabel>Elegí la sucursal</DropdownMenuLabel>
                    {me.branches.map((branch) => (
                      <DropdownMenuItem key={branch.id} onSelect={() => chooseBranch(branch.id)}>
                        {branch.name}
                        {branch.id === currentBranch.id && <Check className="ml-auto" />}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <SidebarMenuButton size="lg" tooltip={currentBranch.name} className="pointer-events-none">
                  <Store />
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="text-xs text-muted-foreground">Sucursal</span>
                    <span className="truncate font-medium">{currentBranch.name}</span>
                  </div>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => {
                const Icon = ICONS[item.icon];
                const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
                      <Link href={item.href} onClick={() => isMobile && setOpenMobile(false)}>
                        <Icon />
                        <span>{item.label}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" tooltip={me.user.name}>
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-sm font-semibold text-primary-foreground">
                    {initials(me.user.name)}
                  </span>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-medium">{me.user.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {ROLE_LABEL[me.accessLevel]}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="font-medium">{me.user.name}</div>
                  <div className="text-xs text-muted-foreground">{me.user.email}</div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Sun className="dark:hidden" />
                    <Moon className="hidden dark:block" />
                    Apariencia
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuRadioGroup value={theme ?? 'system'} onValueChange={setTheme}>
                      <DropdownMenuRadioItem value="light">
                        <Sun /> Claro
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="dark">
                        <Moon /> Oscuro
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="system">
                        <Monitor /> Como el sistema
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={logout}>
                  <LogOut />
                  Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
