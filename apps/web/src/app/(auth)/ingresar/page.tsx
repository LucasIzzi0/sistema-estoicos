import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CustomerLogin } from './customer-login';

export const metadata: Metadata = { title: 'Ingresar' };

export default function Page() {
  return (
    <Suspense>
      <CustomerLogin />
    </Suspense>
  );
}
