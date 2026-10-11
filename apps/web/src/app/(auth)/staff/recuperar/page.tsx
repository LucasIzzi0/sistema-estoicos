import type { Metadata } from 'next';
import { Suspense } from 'react';
import { RecoverPassword } from './recover-password';

export const metadata: Metadata = { title: 'Recuperar contraseña' };

export default function Page() {
  return (
    <Suspense>
      <RecoverPassword />
    </Suspense>
  );
}
