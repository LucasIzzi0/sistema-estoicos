import Link from 'next/link';
import { Wordmark } from '@/components/brand';

/**
 * Pantallas de acceso. Fondo con el degradé de la marca y la tarjeta al centro: es lo primero
 * que ve alguien del equipo cada mañana, y lo primero que ve un cliente que vuelve.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden bg-muted/30">
      {/* Luz tenue arriba: le da profundidad sin distraer y se apaga suave, sin borde. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(75%_45%_at_50%_0%,color-mix(in_oklch,var(--color-gold)_14%,transparent),transparent_72%)]"
      />
      <header className="relative px-4 py-5">
        <Link href="/" aria-label="Inicio">
          <Wordmark />
        </Link>
      </header>
      <main className="relative flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pb-24">
        <div className="w-full max-w-sm">{children}</div>
      </main>
      <footer className="relative px-4 pb-6 text-center text-xs text-muted-foreground">
        Barbería Estoicos
      </footer>
    </div>
  );
}
