import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Validación de la firma de los webhooks de Mercado Pago (docs/fase-0/01-arquitectura.md §9.4).
 *
 * El header `x-signature` viene como "ts=1704908010,v1=<hmac>". El texto a firmar es
 * `id:<data.id>;request-id:<x-request-id>;ts:<ts>;` y cada tramo se omite si falta ese dato.
 * El `data.id` sale de la query string y va en MINÚSCULAS si es alfanumérico.
 *
 * No se rechaza por antigüedad del `ts`: MP no documenta si sus reintentos reusan el `ts` y
 * descartarlos podría perder un pago. No hace falta, porque el contenido nunca se cree y el
 * procesamiento es idempotente.
 */
export interface SignatureParts {
  ts: string;
  v1: string;
}

export function parseSignatureHeader(header: string | undefined): SignatureParts | null {
  if (!header) return null;
  const parts = new Map<string, string>();
  for (const chunk of header.split(',')) {
    const [key, ...rest] = chunk.split('=');
    if (!key || rest.length === 0) continue;
    parts.set(key.trim(), rest.join('=').trim());
  }
  const ts = parts.get('ts');
  const v1 = parts.get('v1');
  return ts && v1 ? { ts, v1 } : null;
}

export function buildSignedManifest(input: {
  dataId?: string | undefined;
  requestId?: string | undefined;
  ts: string;
}): string {
  let manifest = '';
  if (input.dataId)
    manifest += `id:${/^[0-9]+$/.test(input.dataId) ? input.dataId : input.dataId.toLowerCase()};`;
  if (input.requestId) manifest += `request-id:${input.requestId};`;
  manifest += `ts:${input.ts};`;
  return manifest;
}

/** Firma un manifiesto (lo usa el simulador y los tests). */
export function signManifest(manifest: string, secret: string): string {
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

/** Compara en tiempo constante: nunca revela cuánto coincide una firma inválida. */
export function verifyWebhookSignature(input: {
  signatureHeader: string | undefined;
  requestId?: string | undefined;
  dataId?: string | undefined;
  secret: string;
}): boolean {
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed) return false;
  const expected = signManifest(
    buildSignedManifest({ dataId: input.dataId, requestId: input.requestId, ts: parsed.ts }),
    input.secret,
  );
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(parsed.v1, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}
