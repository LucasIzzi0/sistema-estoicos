import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/server-env';

/**
 * Proxy (BFF): el navegador solo habla con la web; esto reenvía /api/v1/* a la API por la red
 * privada de Railway (docs/fase-0/01-arquitectura.md §3). Mismo origen: sin CORS y con cookies
 * atadas a este dominio.
 */
const FORWARDED_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'cookie',
  'user-agent',
  'origin',
  'x-request-id',
  // Cobros y anulaciones: el mismo pedido repetido (doble clic) no se ejecuta dos veces.
  'idempotency-key',
];

function clientIp(request: NextRequest): string {
  // Detrás de Cloudflare la IP real viene en CF-Connecting-IP (el proxy de Next ya validó el origen).
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-real-ip') ??
    ''
  );
}

async function forward(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  if (path[0] !== 'v1') {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'No encontrado.' } }, { status: 404 });
  }

  // CSRF: una mutación tiene que venir de esta misma web.
  const origin = request.headers.get('origin');
  if (!['GET', 'HEAD'].includes(request.method) && origin && origin !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Origen no permitido.' } },
      { status: 403 },
    );
  }

  const headers = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-internal-secret', serverEnv.internalApiSecret);
  headers.set('x-client-ip', clientIp(request));

  let upstream: Response;
  try {
    upstream = await fetch(`${serverEnv.apiInternalUrl}/${path.join('/')}${request.nextUrl.search}`, {
      method: request.method,
      headers,
      body: ['GET', 'HEAD'].includes(request.method) ? undefined : await request.arrayBuffer(),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'API_UNAVAILABLE',
          message: 'El sistema no responde en este momento. Probá de nuevo en un minuto.',
        },
      },
      { status: 502 },
    );
  }

  const responseHeaders = new Headers();
  // `content-disposition` es lo que hace que un export baje como archivo y con su nombre.
  for (const name of ['content-type', 'content-disposition']) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  responseHeaders.set('cache-control', 'private, no-store');
  for (const cookie of upstream.headers.getSetCookie()) responseHeaders.append('set-cookie', cookie);

  return new NextResponse(upstream.body, { status: upstream.status, headers: responseHeaders });
}

export { forward as GET, forward as POST, forward as PUT, forward as PATCH, forward as DELETE };
