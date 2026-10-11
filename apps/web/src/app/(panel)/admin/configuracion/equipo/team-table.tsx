'use client';

import type { StaffMe, StaffMember } from '@estoicos/shared';
import { MoreHorizontal, Users } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';
import { toast } from 'sonner';
import { EmptyState } from '@/components/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { api, ApiClientError } from '@/lib/api/client';

const LEVEL_LABEL: Record<StaffMember['accessLevel'], string> = {
  OWNER: 'Dueño',
  BRANCH_ADMIN: 'Encargado',
  RECEPTION: 'Recepción',
};

export function TeamTable({ me, members }: { me: StaffMe; members: StaffMember[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const branchName = new Map(me.branches.map((b) => [b.id, b.name]));

  function run(action: () => Promise<unknown>, success: string) {
    startTransition(async () => {
      try {
        await action();
        toast.success(success);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo completar la acción.');
      }
    });
  }

  if (members.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Todavía no hay nadie más"
        description="Invitá al encargado o a recepción: cada uno entra con su usuario y ve solo lo suyo."
      />
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Persona</TableHead>
            <TableHead>Rol</TableHead>
            <TableHead>Sucursales</TableHead>
            <TableHead>Estado</TableHead>
            <TableHead className="w-10">
              <span className="sr-only">Acciones</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => {
            const isMe = m.membershipId === me.membershipId;
            return (
              <TableRow key={m.membershipId} className={m.active ? undefined : 'opacity-60'}>
                <TableCell>
                  <div className="font-medium">
                    {m.name}
                    {isMe && <span className="text-muted-foreground"> (vos)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">{m.email}</div>
                </TableCell>
                <TableCell>{LEVEL_LABEL[m.accessLevel]}</TableCell>
                <TableCell className="text-sm">
                  {m.allBranches
                    ? 'Todas'
                    : m.branchIds.map((id) => branchName.get(id) ?? 'Otra sucursal').join(', ')}
                </TableCell>
                <TableCell>
                  {!m.active ? (
                    <Badge variant="outline">Desactivado</Badge>
                  ) : !m.hasPassword ? (
                    <Badge variant="secondary">Invitación pendiente</Badge>
                  ) : (
                    <Badge>Activo</Badge>
                  )}
                </TableCell>
                <TableCell>
                  {!isMe && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={pending}
                          aria-label={`Acciones para ${m.name}`}
                        >
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {m.active && !m.hasPassword && (
                          <DropdownMenuItem
                            onSelect={() =>
                              run(
                                () =>
                                  api('/v1/staff/invitations', {
                                    body: {
                                      name: m.name,
                                      email: m.email,
                                      role: m.role,
                                      allBranches: m.allBranches,
                                      branchIds: m.branchIds,
                                    },
                                  }),
                                `Reenviamos la invitación a ${m.email}.`,
                              )
                            }
                          >
                            Reenviar invitación
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          variant={m.active ? 'destructive' : 'default'}
                          onSelect={() =>
                            run(
                              () =>
                                api(`/v1/staff/${m.membershipId}`, {
                                  method: 'PATCH',
                                  body: { active: !m.active },
                                }),
                              m.active
                                ? `${m.name} ya no puede entrar al sistema.`
                                : `${m.name} puede volver a entrar.`,
                            )
                          }
                        >
                          {m.active ? 'Desactivar acceso' : 'Reactivar acceso'}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
