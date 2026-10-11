'use client';

import type { CustomerMe } from '@estoicos/shared';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { EmailCodeForm } from '@/components/auth/email-code-form';
import { ProfileForm } from '@/components/customer/profile-form';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { safeNext } from '@/lib/navigation';

type Step = { name: 'email' } | { name: 'code'; email: string } | { name: 'profile'; me: CustomerMe };

/** Acceso de clientes sin contraseña: email → código de 6 números → (si es nuevo) datos. */
export function CustomerLogin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get('next'), '/mi-cuenta');
  const [step, setStep] = useState<Step>({ name: 'email' });

  function finish() {
    router.replace(next);
    router.refresh();
  }

  if (step.name === 'profile') {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">¡Bienvenido!</CardTitle>
          <CardDescription>
            Completá tus datos una sola vez para reservar y recibir los avisos de tus turnos.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileForm initial={step.me} submitLabel="Listo" onSaved={finish} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">
          {step.name === 'email' ? 'Ingresá con tu email' : 'Revisá tu email'}
        </CardTitle>
        <CardDescription>
          {step.name === 'email'
            ? 'Te mandamos un código de 6 números. No necesitás contraseña.'
            : `Escribí el código que te mandamos a ${step.email}.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <EmailCodeForm
          onStepChange={(s, email) => setStep(s === 'code' ? { name: 'code', email } : { name: 'email' })}
          onVerified={(customer) =>
            customer.needsProfile ? setStep({ name: 'profile', me: customer }) : finish()
          }
        />
      </CardContent>
    </Card>
  );
}
