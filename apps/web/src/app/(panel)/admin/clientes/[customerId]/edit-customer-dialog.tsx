'use client';

import type { CustomerDetail } from '@estoicos/shared';
import { Pencil } from 'lucide-react';
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

export function EditCustomerDialog({ customer }: { customer: CustomerDetail }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <Pencil />
          Editar datos
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar datos</DialogTitle>
          <DialogDescription>Los cambios de consentimiento quedan registrados con fecha.</DialogDescription>
        </DialogHeader>
        <CustomerForm
          customer={customer}
          onSaved={() => {
            toast.success('Datos guardados.');
            setOpen(false);
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
