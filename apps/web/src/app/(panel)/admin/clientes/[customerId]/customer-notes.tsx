'use client';

import type { CustomerDetail } from '@estoicos/shared';
import { Pin, PinOff, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { api, ApiClientError } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format';

/** Notas del staff: cómo le gusta el corte, preferencias, avisos. Las fijadas van arriba. */
export function CustomerNotes(props: { customer: CustomerDetail; canUpdate: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pending, startTransition] = useTransition();
  const base = `/v1/customers/${props.customer.id}/notes`;

  function run(action: () => Promise<unknown>, onDone?: () => void) {
    startTransition(async () => {
      try {
        await action();
        onDone?.();
        router.refresh();
      } catch (e) {
        toast.error(e instanceof ApiClientError ? e.message : 'No se pudo guardar la nota.');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Notas</CardTitle>
        <CardDescription>Ej.: “degradé en 1, arriba con tijera, no le gusta la navaja”.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {props.canUpdate && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (body.trim())
                run(
                  () => api(base, { body: { body } }),
                  () => setBody(''),
                );
            }}
          >
            <textarea
              aria-label="Nueva nota"
              className="min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              placeholder="Escribí una nota…"
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
            <Button type="submit" size="sm" className="w-fit" disabled={pending || !body.trim()}>
              Agregar nota
            </Button>
          </form>
        )}
        {props.customer.notes.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin notas todavía.</p>
        ) : (
          <ul className="grid gap-2">
            {props.customer.notes.map((n) => (
              <li
                key={n.id}
                className={`rounded-lg border p-3 text-sm ${n.pinned ? 'border-primary/40 bg-primary/5' : ''}`}
              >
                <p className="whitespace-pre-wrap">{n.body}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <span>
                    {n.authorName} · {formatDateTime(n.createdAt)}
                  </span>
                  {props.canUpdate && (
                    <span className="ml-auto flex gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={pending}
                        aria-label={n.pinned ? 'Desfijar nota' : 'Fijar nota arriba'}
                        onClick={() =>
                          run(() => api(`${base}/${n.id}`, { method: 'PATCH', body: { pinned: !n.pinned } }))
                        }
                      >
                        {n.pinned ? <PinOff /> : <Pin />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-7"
                        disabled={pending}
                        aria-label="Borrar nota"
                        onClick={() => run(() => api(`${base}/${n.id}`, { method: 'DELETE' }))}
                      >
                        <Trash2 />
                      </Button>
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
