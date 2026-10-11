'use client';

import { BellOff, CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';

/**
 * La baja se confirma con un toque (no se aplica sola al abrir el link: los previsualizadores
 * de algunos correos abren los links y daría de baja a quien no quiso).
 */
export function Unsubscribe({ customerId, token }: { customerId: string; token: string }) {
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!customerId || !token) {
    return (
      <p className="text-center text-muted-foreground">
        Ese link está incompleto. Podés cambiar tus preferencias desde tu cuenta.
      </p>
    );
  }

  if (done) {
    return (
      <div className="grid justify-items-center gap-4 text-center">
        <CheckCircle2 className="size-12 text-success" />
        <h1 className="text-2xl font-extrabold uppercase">Listo</h1>
        <p className="text-muted-foreground">
          No te vamos a mandar más promociones. Los avisos de tus turnos te siguen llegando.
        </p>
        <Button asChild variant="outline">
          <Link href="/mi-cuenta/perfil">Cambiar mis preferencias</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="grid justify-items-center gap-4 text-center">
      <BellOff className="size-12 text-muted-foreground" />
      <h1 className="text-2xl font-extrabold uppercase">¿No querés más promociones?</h1>
      <p className="text-muted-foreground">
        Dejás de recibir novedades y recordatorios de volver. Los avisos de tus turnos te siguen llegando.
      </p>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              await api(`/v1/public/unsubscribe?c=${customerId}&t=${encodeURIComponent(token)}`, {
                method: 'POST',
                body: {},
              });
              setDone(true);
            } catch {
              // Se muestra el mismo mensaje exista o no el cliente: no se revela quién está registrado.
              setError('Ese link ya no sirve. Podés cambiar tus preferencias desde tu cuenta.');
            }
          })
        }
      >
        {pending ? 'Un segundo…' : 'Sí, darme de baja'}
      </Button>
      <Link href="/mi-cuenta/perfil" className="text-sm text-muted-foreground underline underline-offset-4">
        Prefiero elegir qué recibir
      </Link>
    </div>
  );
}
