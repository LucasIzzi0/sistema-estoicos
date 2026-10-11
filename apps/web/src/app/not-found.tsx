import { Scissors } from 'lucide-react';
import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { Button } from '@/components/ui/button';

/** Página que no existe: en vez de un error seco, una salida. */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-4 py-6">
        <Link href="/" aria-label="Inicio">
          <Wordmark />
        </Link>
      </header>
      <main className="mx-auto grid w-full max-w-sm flex-1 content-center justify-items-center gap-5 px-4 pb-24 text-center">
        <span className="grid size-14 place-items-center rounded-full bg-muted text-muted-foreground">
          <Scissors className="size-6" />
        </span>
        <div className="grid gap-2">
          <h1 className="text-3xl font-extrabold uppercase">Esta página no existe</h1>
          <p className="text-muted-foreground">
            Puede que el link esté viejo o que se haya escrito mal la dirección.
          </p>
        </div>
        <Button asChild size="lg">
          <Link href="/">Volver al inicio</Link>
        </Button>
      </main>
    </div>
  );
}
