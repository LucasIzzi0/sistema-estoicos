'use client';

import { STAFF_AUTH } from '@estoicos/shared';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ApiClientError } from '@/lib/api/client';

/** Elegir contraseña (invitación o recuperación). La regla la valida también la API. */
export function NewPasswordForm(props: {
  submitLabel: string;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (password.length < STAFF_AUTH.passwordMinLength) {
      setError(`La contraseña debe tener al menos ${STAFF_AUTH.passwordMinLength} caracteres.`);
      return;
    }
    if (password !== confirm) {
      setError('Las contraseñas no coinciden.');
      return;
    }
    startTransition(async () => {
      try {
        await props.onSubmit(password);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo guardar la contraseña.');
      }
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="new-password">Contraseña nueva</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          required
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">
          Al menos {STAFF_AUTH.passwordMinLength} caracteres. Una frase es más segura y fácil de recordar.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="confirm-password">Repetila</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={pending}>
        {pending ? 'Guardando…' : props.submitLabel}
      </Button>
    </form>
  );
}
