import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCustomerMe } from '@/lib/api/server';
import { CustomerProfile } from './customer-profile';

export const metadata: Metadata = { title: 'Mi perfil' };

export default async function ProfilePage() {
  const me = await getCustomerMe();
  if (!me) redirect('/ingresar?next=/mi-cuenta/perfil');
  return (
    <div className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-3xl font-extrabold uppercase text-gold">Mi perfil</h1>
        <p className="text-sm text-muted-foreground">Ingresás con {me.email}.</p>
      </div>
      <CustomerProfile me={me} />
    </div>
  );
}
