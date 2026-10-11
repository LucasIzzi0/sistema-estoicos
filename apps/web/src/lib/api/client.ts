'use client';

/** Error de la API con el mensaje en español listo para mostrar. */
export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/**
 * Llamada a la API desde el navegador. Va al mismo origen (/api/…) y el servidor de la web
 * la reenvía a la API por la red privada. La cookie de sesión viaja sola (HttpOnly).
 */
export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; idempotencyKey?: string } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
      headers: {
        ...(options.body === undefined
          ? { accept: 'application/json' }
          : { 'content-type': 'application/json' }),
        ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiClientError('No hay conexión. Revisá tu internet y probá de nuevo.', 0, 'NETWORK');
  }
  const payload = response.headers.get('content-type')?.includes('application/json')
    ? await response.json()
    : null;
  if (!response.ok) {
    const error = payload?.error;
    throw new ApiClientError(
      error?.message ?? 'Ocurrió un error. Probá de nuevo.',
      response.status,
      error?.code ?? 'ERROR',
      error?.details,
    );
  }
  return payload as T;
}
