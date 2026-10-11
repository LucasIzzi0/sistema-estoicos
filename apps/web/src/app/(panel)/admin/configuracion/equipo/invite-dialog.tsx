'use client';

import type { StaffMe, StaffMember } from '@estoicos/shared';
import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, ApiClientError } from '@/lib/api/client';

/** Recepción existe en el sistema pero queda oculta hasta que la barbería la necesite. */
const SHOW_RECEPTION = false;

type Kind = 'OWNER' | 'BRANCH_ADMIN' | 'RECEPTION';

export function InviteDialog({ me }: { me: StaffMe }) {
  const router = useRouter();
  const isOwner = me.accessLevel === 'OWNER';
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [kind, setKind] = useState<Kind>(isOwner ? 'BRANCH_ADMIN' : 'RECEPTION');
  const [branchIds, setBranchIds] = useState<string[]>(me.branches.length === 1 ? [me.branches[0]!.id] : []);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const kinds: { value: Kind; label: string }[] = [
    ...(isOwner
      ? [
          { value: 'OWNER' as const, label: 'Dueño: ve y configura todo, en todas las sucursales' },
          { value: 'BRANCH_ADMIN' as const, label: 'Encargado: administra solo sus sucursales' },
        ]
      : []),
    ...(SHOW_RECEPTION
      ? [{ value: 'RECEPTION' as const, label: 'Recepción: agenda, clientes y cobro' }]
      : []),
  ];

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      try {
        const member = await api<StaffMember>('/v1/staff/invitations', {
          body: {
            name,
            email,
            role: kind === 'RECEPTION' ? 'RECEPTION' : 'ADMIN',
            allBranches: kind === 'OWNER',
            branchIds: kind === 'OWNER' ? [] : branchIds,
          },
        });
        toast.success(`Le enviamos la invitación a ${member.email}. El link vence en 72 horas.`);
        setOpen(false);
        setName('');
        setEmail('');
        router.refresh();
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo enviar la invitación.');
      }
    });
  }

  if (kinds.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus />
          Invitar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invitar un usuario</DialogTitle>
          <DialogDescription>Le llega un email con un link para elegir su contraseña.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="invite-name">Nombre y apellido</Label>
            <Input id="invite-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="invite-role">Rol</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
              <SelectTrigger id="invite-role" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {kinds.map((k) => (
                  <SelectItem key={k.value} value={k.value}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {kind !== 'OWNER' && (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Sucursales</legend>
              {me.branches.map((branch) => (
                <label key={branch.id} className="flex items-center gap-3 text-sm">
                  <Checkbox
                    checked={branchIds.includes(branch.id)}
                    onCheckedChange={(checked) =>
                      setBranchIds((ids) =>
                        checked === true ? [...ids, branch.id] : ids.filter((id) => id !== branch.id),
                      )
                    }
                  />
                  {branch.name}
                </label>
              ))}
            </fieldset>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Enviando…' : 'Enviar invitación'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
