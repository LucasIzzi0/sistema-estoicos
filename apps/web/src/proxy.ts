import { timingSafeEqual } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIES } from '@/lib/session-cookies';

/**
 * Proxy de Next 16 (ex middleware). Corre antes de cada página:
 * 1. Si hay Cloudflare delante, rechaza lo que no pasó por Cloudflare (header secreto).
 * 2. Manda al login a quien entra a un panel sin cookie de sesión. La validez real de la
 *    sesión la verifica SIEMPRE la API; esto solo evita mostrar una pantalla vacía.
 */
function sameSecret(a: string, b: string) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  const originSecret = process.env.CLOUDFLARE_ORIGIN_SECRET;
  if (
    originSecret &&
    pathname !== '/healthz' &&
    !sameSecret(request.headers.get('x-origin-auth') ?? '', originSecret)
  ) {
    return new NextResponse('Forbidden', { status: 403 });
  }

  const next = encodeURIComponent(pathname + search);
  if (
    (pathname.startsWith('/admin') || pathname.startsWith('/imprimir')) &&
    !request.cookies.has(SESSION_COOKIES.staff)
  ) {
    return NextResponse.redirect(new URL(`/staff/ingresar?next=${next}`, request.url));
  }
  if (pathname.startsWith('/mi-cuenta') && !request.cookies.has(SESSION_COOKIES.customer)) {
    return NextResponse.redirect(new URL(`/ingresar?next=${next}`, request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg).*)'],
};
