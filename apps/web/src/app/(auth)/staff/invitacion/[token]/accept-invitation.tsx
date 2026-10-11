'use client';

import type { StaffMe } from '@estoicos/shared';
import { useRouter } from 'next/navigation';
import { NewPasswordForm } from '@/components/auth/new-password-form';
import { api } from '@/lib/api/client';
import { staffHome } from '@/lib/navigation';

export function AcceptInvitation({ token }: { token: string }) {
  const router = useRouter();
  return (
    <NewPasswordForm
      submitLabel="Entrar al sistema"
      onSubmit={async (password) => {
        const me = await api<StaffMe>('/v1/auth/staff/invitations/accept', { body: { token, password } });
        router.replace(staffHome(me));
        router.refresh();
      }}
    />
  );
}
