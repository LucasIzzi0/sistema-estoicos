import 'server-only';
import type { CustomerMe, StaffMe, SystemHealth } from '@estoicos/shared';
import { cookies, headers } from 'next/headers';
import { cache } from 'react';
import { serverEnv } from '../server-env';

/**
 * Llamada a la API desde el servidor de la web (Server Components), por la red privada.
 * Reenvía las cookies del usuario y el secreto interno.
 */
export async function serverApi<T>(
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; data: T | null }> {
  const cookieHeader = (await cookies()).toString();
  const requestHeaders = await headers();
  const response = await fetch(`${serverEnv.apiInternalUrl}${path}`, {
    ...init,
    cache: 'no-store',
    headers: {
      accept: 'application/json',
      'x-internal-secret': serverEnv.internalApiSecret,
      'x-client-ip': requestHeaders.get('x-client-ip') ?? '',
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
      ...init.headers,
    },
  });
  const data = response.headers.get('content-type')?.includes('application/json')
    ? ((await response.json()) as T)
    : null;
  return { status: response.status, data: response.ok ? data : null };
}

/** Staff con sesión válida (o null). Se cachea por pedido. */
export const getStaffMe = cache(async (): Promise<StaffMe | null> => {
  const { data } = await serverApi<StaffMe>('/v1/me/staff');
  return data;
});

export const getCustomerMe = cache(async (): Promise<CustomerMe | null> => {
  const { data } = await serverApi<CustomerMe>('/v1/me/customer');
  return data;
});

export async function getSystemHealth(): Promise<SystemHealth | null> {
  const { data } = await serverApi<SystemHealth>('/v1/system/health');
  return data;
}
