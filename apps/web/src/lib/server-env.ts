import 'server-only';

/** Variables de entorno del servidor de la web. Nunca llegan al navegador. */
export const serverEnv = {
  appPublicUrl: process.env.APP_PUBLIC_URL ?? 'http://localhost:3000',
  apiInternalUrl: process.env.API_INTERNAL_URL ?? 'http://localhost:4000',
  internalApiSecret: process.env.INTERNAL_API_SECRET ?? '',
  cloudflareOriginSecret: process.env.CLOUDFLARE_ORIGIN_SECRET ?? '',
};
