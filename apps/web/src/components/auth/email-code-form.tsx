'use client';

import type { CustomerMe } from '@estoicos/shared';
import { useEffect, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { CodeInput } from '@/components/auth/code-input';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiClientError } from '@/lib/api/client';

/**
 * Acceso de clientes sin contraseña: email → código de 6 números. Lo usan la pantalla de
 * ingreso y la reserva online. Al validar el código, la sesión queda abierta (cookie HttpOnly).
 */
export function EmailCodeForm(props: {
  onVerified: (customer: CustomerMe) => void;
  onStepChange?: (step: 'email' | 'code', email: string) => void;
  submitLabel?: string;
}) {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  function goTo(next: 'email' | 'code') {
    setStep(next);
    props.onStepChange?.(next, email);
  }

  function requestCode() {
    setError(null);
    startTransition(async () => {
      try {
        const { message } = await api<{ message: string }>('/v1/auth/customer/request-code', {
          body: { email },
        });
        toast.success(message);
        setCode('');
        goTo('code');
        setResendIn(30);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo enviar el código.');
      }
    });
  }

  function verify(value: string) {
    setError(null);
    startTransition(async () => {
      try {
        const { customer } = await api<{ customer: CustomerMe }>('/v1/auth/customer/verify-code', {
          body: { email, code: value },
        });
        props.onVerified(customer);
      } catch (e) {
        setCode('');
        setError(e instanceof ApiClientError ? e.message : 'No se pudo validar el código.');
      }
    });
  }

  if (step === 'email') {
    return (
      <form
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          requestCode();
        }}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            inputMode="email"
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
          {pending ? 'Enviando…' : (props.submitLabel ?? 'Enviarme el código')}
        </Button>
      </form>
    );
  }

  return (
    <div className="grid gap-4">
      <CodeInput value={code} onChange={setCode} onComplete={verify} disabled={pending} />
      {error && (
        <p className="text-center text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      <Button size="lg" disabled={pending || code.length < 6} onClick={() => verify(code)}>
        {pending ? 'Validando…' : 'Ingresar'}
      </Button>
      <div className="flex justify-between text-sm">
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:underline"
          onClick={() => goTo('email')}
        >
          Cambiar email
        </button>
        <button
          type="button"
          className="text-muted-foreground underline-offset-4 hover:underline disabled:no-underline disabled:opacity-60"
          disabled={resendIn > 0 || pending}
          onClick={requestCode}
        >
          {resendIn > 0 ? `Reenviar en ${resendIn} s` : 'Reenviar código'}
        </button>
      </div>
    </div>
  );
}
