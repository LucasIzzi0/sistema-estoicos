'use client';

import { EXPENSE_METHOD_LABELS, EXPENSE_METHODS, todayIn, type ExpenseCategoryDto } from '@estoicos/shared';
import { Receipt } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { MoneyInput } from '@/components/form/money-input';
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

/**
 * Egreso. Desde la caja (`fromCash`) sale en efectivo de la caja abierta y descuenta del esperado.
 * Desde "Egresos del mes" se puede cargar cualquier gasto (alquiler, servicios) con o sin sucursal.
 */
export function ExpenseDialog(props: {
  branchId: string | null;
  categories: ExpenseCategoryDto[];
  fromCash?: boolean;
  branches?: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState<number | null>(null);
  const [method, setMethod] = useState<(typeof EXPENSE_METHODS)[number]>('CASH');
  const [date, setDate] = useState(() => todayIn('America/Argentina/Buenos_Aires'));
  const [description, setDescription] = useState('');
  const [supplier, setSupplier] = useState('');
  const [branchId, setBranchId] = useState<string>(props.branchId ?? 'general');
  const [fromCash, setFromCash] = useState(!!props.fromCash);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const branch = branchId === 'general' ? null : branchId;
    const cash = fromCash && method === 'CASH' && !!branch;
    startTransition(async () => {
      try {
        await api('/v1/expenses', {
          body: {
            branchId: branch,
            categoryId,
            amountCents: amount ?? 0,
            method,
            occurredOn: date,
            description,
            supplier: supplier.trim() || null,
            fromCashSession: cash,
          },
        });
        toast.success('Egreso registrado.');
        setOpen(false);
        setAmount(null);
        setDescription('');
        setSupplier('');
        router.refresh();
      } catch (err) {
        setError(err instanceof ApiClientError ? err.message : 'No se pudo guardar.');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size={props.fromCash ? 'sm' : 'default'}>
          <Receipt /> {props.fromCash ? 'Egreso de caja' : 'Nuevo egreso'}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{props.fromCash ? 'Egreso pagado con la caja' : 'Nuevo egreso'}</DialogTitle>
          <DialogDescription>
            Insumos, limpieza, alquiler, servicios… Las comisiones se pagan desde cada liquidación.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ex-cat">Categoría</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger id="ex-cat" className="w-full">
                  <SelectValue placeholder="Elegí" />
                </SelectTrigger>
                <SelectContent>
                  {props.categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ex-amount">Monto</Label>
              <MoneyInput id="ex-amount" value={amount} onChange={setAmount} required />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="ex-desc">Detalle</Label>
            <Input
              id="ex-desc"
              required
              maxLength={200}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Ej.: productos de limpieza"
            />
          </div>
          {!props.fromCash && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ex-method">Medio</Label>
                  <Select value={method} onValueChange={(v) => setMethod(v as typeof method)}>
                    <SelectTrigger id="ex-method" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPENSE_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>
                          {EXPENSE_METHOD_LABELS[m]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ex-date">Fecha</Label>
                  <Input
                    id="ex-date"
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>
              {props.branches && (
                <div className="grid gap-1.5">
                  <Label htmlFor="ex-branch">Sucursal</Label>
                  <Select value={branchId} onValueChange={setBranchId}>
                    <SelectTrigger id="ex-branch" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="general">General (de toda la marca)</SelectItem>
                      {props.branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="ex-supplier">Proveedor (opcional)</Label>
                <Input
                  id="ex-supplier"
                  maxLength={100}
                  value={supplier}
                  onChange={(e) => setSupplier(e.target.value)}
                />
              </div>
              {method === 'CASH' && branchId !== 'general' && (
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={fromCash} onCheckedChange={(v) => setFromCash(v === true)} />
                  Salió de la caja abierta (descuenta del efectivo esperado)
                </label>
              )}
            </>
          )}
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="submit" disabled={pending || !amount || !categoryId}>
              Registrar egreso
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
