import type { Metadata } from 'next';
import Link from 'next/link';
import type { z } from 'zod';
import type { invitationInfoSchema } from '@estoicos/shared';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { serverApi } from '@/lib/api/server';
import { AcceptInvitation } from './accept-invitation';

export const metadata: Metadata = { title: 'Invitación' };

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const { data } = await serverApi<z.infer<typeof invitationInfoSchema>>(
    `/v1/auth/staff/invitations/${encodeURIComponent(token)}`,
  );

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">La invitación no es válida</CardTitle>
          <CardDescription>
            Puede haber vencido (dura 72 horas) o ya se usó. Pedile al dueño que te invite de nuevo.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline" className="w-full">
            <Link href="/staff/ingresar">Ya tengo cuenta</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Hola, {data.name.split(' ')[0]}</CardTitle>
        <CardDescription>
          Te invitaron al sistema de {data.organizationName} como{' '}
          {data.role === 'ADMIN' ? 'administrador' : 'recepción'}. Elegí tu contraseña para entrar con{' '}
          {data.email}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <AcceptInvitation token={token} />
      </CardContent>
    </Card>
  );
}
