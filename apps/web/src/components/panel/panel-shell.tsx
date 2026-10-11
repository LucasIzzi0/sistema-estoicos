import type { StaffMe } from '@estoicos/shared';
import { CalendarDays, Receipt } from 'lucide-react';
import { cookies } from 'next/headers';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { BRANCH_COOKIE } from '@/lib/session-cookies';
import { AppSidebar } from './app-sidebar';
import type { NavItem } from './nav';

/**
 * Marco del panel: sidebar fijo a la izquierda, colapsable a íconos en
 * escritorio y como drawer en el celular.
 */
export async function PanelShell(props: { me: StaffMe; nav: NavItem[]; children: React.ReactNode }) {
  const store = await cookies();
  const defaultOpen = store.get('sidebar_state')?.value !== 'false';
  const chosen = store.get(BRANCH_COOKIE)?.value;
  const currentBranch = props.me.branches.find((b) => b.id === chosen) ?? props.me.branches[0] ?? null;
  const puedeAgenda = props.nav.some((item) => item.href === '/admin/agenda');
  const puedeCaja = props.nav.some((item) => item.href === '/admin/caja');

  return (
    <SidebarProvider defaultOpen={defaultOpen}>
      <a href="#contenido" className="skip-link">
        Ir al contenido
      </a>
      <AppSidebar me={props.me} nav={props.nav} currentBranch={currentBranch} />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-14 items-center gap-2 border-b bg-background/95 px-4 backdrop-blur">
          <SidebarTrigger className="-ml-1" aria-label="Abrir o cerrar el menú" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <span className="truncate text-sm text-muted-foreground">
            {props.me.organization.name}
            {currentBranch ? ` · ${currentBranch.name}` : ''}
          </span>
          {/* Atajos a lo que se usa todo el día. En escritorio ya están en el menú lateral,
              así que solo aparecen en el celular, donde el menú está escondido. */}
          <span className="ml-auto flex items-center gap-2 md:hidden">
            {puedeAgenda && (
              <Button asChild size="sm" variant="ghost">
                <Link href="/admin/agenda" aria-label="Ir a la agenda">
                  <CalendarDays /> Agenda
                </Link>
              </Button>
            )}
            {puedeCaja && (
              <Button asChild size="sm">
                <Link href="/admin/caja" aria-label="Ir a la caja">
                  <Receipt /> Caja
                </Link>
              </Button>
            )}
          </span>
        </header>
        <main id="contenido" className="flex-1 p-4 pb-16 md:p-6 md:pb-20">
          {props.children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
