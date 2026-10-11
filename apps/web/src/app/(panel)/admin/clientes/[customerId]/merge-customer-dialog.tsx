'use client';

import type { CustomerDetail } from '@estoicos/shared';
import { Merge } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { api, ApiClientError } from '@/lib/api/client';
import { CustomerPicker, type PickedCustomer } from '@/components/customer/customer-picker';

/**
 * Fusionar un registro repetido en este cliente: pasan sus turnos, notas y datos faltantes;
 * el repetido deja de aparecer. Queda auditado. Solo dueño y encargado.
 */
export function MergeCustomerDialog({ customer }: { customer: CustomerDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [duplicate, setDuplicate] = useState<PickedCustomer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const name = `${customer.firstName} ${customer.lastName}`.trim();

  function merge() {
    if (!duplicate) return;
    setError(null);
    startTransition(async () => {
      try {
        await api(`/v1/customers/${customer.id}/merge`, { body: { duplicateId: duplicate.id } });
        toast.success(`${duplicate.name} quedó fusionado en ${name}.`);
        setOpen(false);
        setDuplicate(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof ApiClientError ? e.message : 'No se pudo fusionar.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Merge /> Fusionar duplicado
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Fusionar un registro repetido</DialogTitle>
          <DialogDescription>
            Buscá el registro repetido. Sus turnos, notas y los datos que le falten a {name} (email, celular,
            DNI) pasan a esta ficha, y el repetido deja de aparecer. No se puede deshacer.
          </DialogDescription>
        </DialogHeader>
        <CustomerPicker
          value={duplicate}
          onChange={(value) => setDuplicate(value && value.id === customer.id ? null : value)}
        />
        {duplicate && (
          <p className="rounded-md border border-warning/50 bg-warning/10 p-3 text-sm">
            <strong>{duplicate.name}</strong> se va a fusionar en <strong>{name}</strong>.
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={!duplicate || pending} onClick={merge}>
            {pending ? 'Fusionando…' : 'Fusionar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
