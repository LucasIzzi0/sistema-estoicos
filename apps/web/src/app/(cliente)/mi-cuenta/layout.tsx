import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Wordmark } from '@/components/brand';
import { getCustomerMe } from '@/lib/api/server';
import { CustomerNav } from './customer-nav';

/** Portal del cliente, mobile first: barra de pestañas abajo en el celular, arriba en escritorio. */
export default async function CustomerLayout({ children }: { children: React.ReactNode }) {
  const me = await getCustomerMe();
  if (!me) redirect('/ingresar?next=/mi-cuenta');

  return (
    <div className="dark flex min-h-dvh flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-gold/20 bg-background/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-4">
          <Link href="/mi-cuenta" aria-label="Inicio de mi cuenta">
            <Wordmark />
          </Link>
          <span className="flex items-center gap-2 truncate text-sm text-muted-foreground">
            Hola, <span className="font-medium text-foreground">{me.firstName || 'cliente'}</span>
          </span>
        </div>
        <div className="mx-auto hidden max-w-3xl px-4 md:block">
          <CustomerNav variant="top" />
        </div>
      </header>
      {me.needsProfile && (
        <div className="border-b bg-warning/10 px-4 py-2 text-center text-sm">
          Completá tus datos para poder reservar.{' '}
          <Link href="/mi-cuenta/perfil" className="font-medium underline underline-offset-4">
            Completar ahora
          </Link>
        </div>
      )}
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-24 pt-6 md:pb-10">{children}</main>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-gold/20 bg-background pb-[env(safe-area-inset-bottom)] md:hidden">
        <CustomerNav variant="bottom" />
      </div>
    </div>
  );
}
