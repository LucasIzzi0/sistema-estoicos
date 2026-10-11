import 'server-only';

/** Variables de entorno del servidor de la web. Nunca llegan al navegador. */
export const serverEnv = {
  apiInternalUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:4000',
  internalApiSecret: process.env.INTERNAL_API_SECRET ?? '',
  cloudflareOriginSecret: process.env.CLOUDFLARE_ORIGIN_SECRET ?? '',
};
