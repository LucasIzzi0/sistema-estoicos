'use client';

import { EXPORT_KIND_HINTS, EXPORT_KIND_LABELS, EXPORT_KINDS, type ExportKind } from '@estoicos/shared';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Bajar planillas. Solo lo ve el dueño (la API lo exige igual) y **cada bajada queda registrada**.
 * El archivo lo arma el servidor: el navegador solo lo guarda.
 */
export function ExportButtons({ from, to, branchId }: { from: string; to: string; branchId: string }) {
  const [busy, setBusy] = useState<ExportKind | null>(null);

  async function download(kind: ExportKind) {
    setBusy(kind);
    try {
      const url = `/api/v1/reports/export/${kind}?from=${from}&to=${to}${branchId ? `&branchId=${branchId}` : ''}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      const name =
        /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')?.[1] ??
        `estoicos-${kind}.csv`;
      const href = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = href;
      link.download = name;
      link.click();
      URL.revokeObjectURL(href);
      toast.success(`Se bajó ${name}`);
    } catch {
      toast.error('No se pudo bajar la planilla.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Bajar a Excel</CardTitle>
        <CardDescription>
          Del período elegido, salvo la lista de clientes, que va completa. Cada bajada queda registrada
          con tu nombre.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2">
        {EXPORT_KINDS.map((kind) => (
          <div key={kind} className="flex items-start justify-between gap-3 rounded-lg border p-3">
            <div className="grid gap-0.5">
              <span className="text-sm font-medium">{EXPORT_KIND_LABELS[kind]}</span>
              <span className="text-xs text-muted-foreground">{EXPORT_KIND_HINTS[kind]}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={() => download(kind)}
              aria-label={`Bajar ${EXPORT_KIND_LABELS[kind]}`}
            >
              <Download />
              {busy === kind ? '…' : 'Bajar'}
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
