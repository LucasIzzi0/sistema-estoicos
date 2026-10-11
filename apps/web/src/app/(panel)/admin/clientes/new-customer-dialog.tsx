'use client';

import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { CustomerForm } from '@/components/customer/customer-form';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';

/** Alta rápida en el local: una sola pantalla, pensada para hacerse en menos de 30 segundos. */
export function NewCustomerDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus />
          Nuevo cliente
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo cliente</DialogTitle>
          <DialogDescription>
            Con el email después puede entrar a su cuenta y ver sus turnos y puntos.
          </DialogDescription>
        </DialogHeader>
        <CustomerForm
          onSaved={(customer) => {
            toast.success(`${customer.firstName} ${customer.lastName} registrado.`);
            setOpen(false);
            router.push(`/admin/clientes/${customer.id}`);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
