'use client';

import { useRouter } from 'next/navigation';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

/** Elegir qué sucursal se está mirando. Con una sola sucursal no aparece. */
export function BranchPicker(props: {
  branchId: string;
  branches: { id: string; name: string }[];
  allBranches: boolean;
}) {
  const router = useRouter();
  if (props.branches.length <= 1) return null;
  return (
    <Select
      value={props.branchId || 'all'}
      onValueChange={(v) => router.push(`/admin/dashboard${v === 'all' ? '' : `?sucursal=${v}`}`)}
    >
      <SelectTrigger className="w-48" aria-label="Sucursal">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">{props.allBranches ? 'Toda la marca' : 'Mis sucursales'}</SelectItem>
        {props.branches.map((b) => (
          <SelectItem key={b.id} value={b.id}>
            {b.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
