'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { NewPasswordForm } from '@/components/auth/new-password-form';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiClientError } from '@/lib/api/client';

export function RecoverPassword() {
  const token = useSearchParams().get('token');
  const [done, setDone] = useState<string | null>(null);

  if (done) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Listo</CardTitle>
          <CardDescription>{done}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild size="lg" className="w-full">
            <Link href="/staff/ingresar">Ir a ingresar</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">Elegí tu contraseña nueva</CardTitle>
          <CardDescription>
            Al guardarla se cierran tus sesiones abiertas en otros dispositivos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <NewPasswordForm
            submitLabel="Guardar contraseña"
            onSubmit={async (password) => {
              await api('/v1/auth/staff/password-reset/confirm', { body: { token, password } });
              setDone('Tu contraseña se cambió. Ya podés ingresar con la nueva.');
            }}
          />
        </CardContent>
      </Card>
    );
  }

  return <RequestLink onSent={setDone} />;
}

function RequestLink({ onSent }: { onSent: (message: string) => void }) {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Recuperar contraseña</CardTitle>
        <CardDescription>Te mandamos un link para elegir una nueva.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              try {
                const { message } = await api<{ message: string }>('/v1/auth/staff/password-reset/request', {
                  body: { email },
                });
                onSent(message);
              } catch (err) {
                setError(err instanceof ApiClientError ? err.message : 'No se pudo enviar el link.');
              }
            });
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? 'Enviando…' : 'Enviarme el link'}
          </Button>
          <Link
            href="/staff/ingresar"
            className="text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
          >
            Volver a ingresar
          </Link>
        </form>
      </CardContent>
    </Card>
  );
}
