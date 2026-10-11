'use client';

import { CalendarPlus, CalendarDays, Gift, History, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/mi-cuenta/reservar', label: 'Reservar', icon: CalendarPlus },
  { href: '/mi-cuenta/turnos', label: 'Mis turnos', icon: CalendarDays },
  { href: '/mi-cuenta/puntos', label: 'Mis puntos', icon: Gift },
  { href: '/mi-cuenta/historial', label: 'Historial', icon: History },
  { href: '/mi-cuenta/perfil', label: 'Perfil', icon: UserRound },
];

export function CustomerNav({ variant }: { variant: 'top' | 'bottom' }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Mi cuenta" className={cn(variant === 'bottom' ? 'grid grid-cols-5' : 'flex gap-6')}>
      {ITEMS.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'text-sm transition-colors',
              variant === 'bottom'
                ? 'flex flex-col items-center gap-1 py-2 text-[11px]'
                : 'border-b-2 py-3 font-medium',
              active
                ? variant === 'bottom'
                  ? 'text-primary'
                  : 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {variant === 'bottom' && <Icon className="size-5" />}
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
