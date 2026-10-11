'use client';

import type { CustomerMe } from '@estoicos/shared';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ProfileForm } from '@/components/customer/profile-form';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';

export function CustomerProfile({ me }: { me: CustomerMe }) {
  const router = useRouter();

  async function logout() {
    await api('/v1/auth/customer/logout', { method: 'POST', body: {} }).catch(() => undefined);
    router.replace('/ingresar');
    router.refresh();
  }

  return (
    <div className="grid gap-6">
      <ProfileForm
        initial={me}
        submitLabel="Guardar cambios"
        onSaved={() => {
          toast.success('Guardamos tus datos.');
          router.refresh();
        }}
      />
      <Button variant="outline" onClick={logout}>
        Cerrar sesión
      </Button>
    </div>
  );
}
