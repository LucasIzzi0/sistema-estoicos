'use client';

import type { Category } from '@estoicos/shared';
import { FolderPlus } from 'lucide-react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, ApiClientError } from '@/lib/api/client';

export function CategoryDialog(props: { kind: 'service' | 'product'; categories: Category[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [pending, startTransition] = useTransition();

  function create(event: React.FormEvent) {
    event.preventDefault();
    startTransition(async () => {
      try {
        await api(`/v1/${props.kind}-categories`, { body: { name, sortOrder: props.categories.length } });
        toast.success(`Categoría "${name}" creada.`);
        setName('');
        setOpen(false);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo crear la categoría.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FolderPlus />
          Categoría
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Nueva categoría</DialogTitle>
          <DialogDescription>
            Existentes: {props.categories.map((c) => c.name).join(', ') || 'ninguna'}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={create} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="category-name">Nombre</Label>
            <Input id="category-name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? 'Creando…' : 'Crear'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
