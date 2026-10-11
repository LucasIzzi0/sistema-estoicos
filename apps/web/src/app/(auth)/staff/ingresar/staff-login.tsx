'use client';

import type { StaffLoginResponse, StaffMe } from '@estoicos/shared';
import { Eye, EyeOff } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useTransition } from 'react';
import { CodeInput } from '@/components/auth/code-input';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiClientError } from '@/lib/api/client';
import { safeNext, staffHome } from '@/lib/navigation';

export function StaffLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'password' | 'second-factor'>('password');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function goToPanel(me: StaffMe) {
    router.replace(safeNext(searchParams.get('next'), staffHome(me)));
    router.refresh();
  }

  function login(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const result = await api<StaffLoginResponse>('/v1/auth/staff/login', { body: { email, password } });
        if (result.requiresSecondFactor) setStep('second-factor');
        else if (result.me) goToPanel(result.me);
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo ingresar.');
      }
    });
  }

  function verify(value: string) {
    setError(null);
    startTransition(async () => {
      try {
        goToPanel(await api<StaffMe>('/v1/auth/staff/second-factor', { body: { code: value } }));
      } catch (e) {
        setCode('');
        setError(e instanceof ApiClientError ? e.message : 'No se pudo validar el código.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">
          {step === 'password' ? 'Acceso del equipo' : 'Verificación'}
        </CardTitle>
        <CardDescription>
          {step === 'password'
            ? 'Para dueños, encargados y recepción.'
            : `Escribí el código que te mandamos a ${email}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {step === 'password' ? (
          <form onSubmit={login} className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Contraseña</Label>
                <Link
                  href="/staff/recuperar"
                  className="text-sm text-muted-foreground underline-offset-4 hover:underline"
                >
                  ¿La olvidaste?
                </Link>
              </div>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  className="pr-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => setShowPassword((visible) => !visible)}
                  aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </div>
            {error && (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? 'Ingresando…' : 'Ingresar'}
            </Button>
          </form>
        ) : (
          <div className="grid gap-4">
            <CodeInput value={code} onChange={setCode} onComplete={verify} disabled={pending} />
            {error && (
              <p className="text-center text-sm text-destructive" role="alert">
                {error}
              </p>
            )}
            <Button size="lg" disabled={pending || code.length < 6} onClick={() => verify(code)}>
              {pending ? 'Validando…' : 'Confirmar'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
