import { CalendarDays, Clock, Gift, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

const VENTAJAS: { icon: LucideIcon; text: string }[] = [
  { icon: CalendarDays, text: 'Elegís el día, el horario y con quién' },
  { icon: Clock, text: 'Cambiás o cancelás desde tu celular' },
  { icon: Gift, text: 'Cada corte suma: el noveno es gratis' },
];

/**
 * Puerta de entrada del cliente. Va siempre en oscuro con dorado, como el cartel del local:
 * es la cara de la barbería, no una pantalla de trabajo.
 */
export default function Home() {
  return (
    <div className="dark relative flex min-h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* Luz cálida desde arriba, como la vidriera de noche. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(85%_50%_at_50%_0%,color-mix(in_oklch,var(--color-gold)_16%,transparent),transparent_70%)]"
      />

      <main className="relative mx-auto grid w-full max-w-md flex-1 content-center gap-9 px-5 py-10">
        {/* Marca, con el marco dorado del cartel. */}
        <div className="grid justify-items-center gap-3 border-y border-gold/35 py-6 text-center">
          <h1 className="brand-title text-5xl uppercase text-gold sm:text-6xl">
            Estoicos
          </h1>
          <p className="text-sm font-medium uppercase tracking-[0.3em] text-foreground/90">Barbería</p>
          <p className="text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
            Disciplina · Estilo · Actitud
          </p>
        </div>

        <ul className="grid gap-2.5 text-sm">
          {VENTAJAS.map(({ icon: Icon, text }) => (
            <li key={text} className="flex items-center gap-3">
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-gold/15 text-gold">
                <Icon className="size-4" />
              </span>
              <span>{text}</span>
            </li>
          ))}
        </ul>

        <div className="grid gap-3">
          <Button asChild size="lg" className="h-12 text-base">
            <Link href="/reservar/principal">Reservar turno</Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="outline"
            className="h-12 border-gold/40 bg-transparent text-base hover:bg-gold/10"
          >
            <Link href="/ingresar">Ingresar a mi cuenta</Link>
          </Button>
        </div>

        <div className="grid justify-items-center gap-4">
          <p className="text-center text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Tu estilo, nuestra prioridad
          </p>
          <Link
            href="/staff/ingresar"
            className="text-sm text-muted-foreground underline-offset-4 transition-colors hover:text-foreground hover:underline"
          >
            Acceso del equipo
          </Link>
        </div>
      </main>
    </div>
  );
}
