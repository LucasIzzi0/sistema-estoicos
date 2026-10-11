import { config as loadEnv } from 'dotenv';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';

const here = path.dirname(fileURLToPath(import.meta.url));
const monorepoRoot = path.join(here, '../..');

// En desarrollo las variables vienen del .env de la raíz del monorepo; en Railway, del entorno.
const rootEnv = path.join(monorepoRoot, '.env');
if (existsSync(rootEnv)) loadEnv({ path: rootEnv, quiet: true });

const nextConfig: NextConfig = {
  outputFileTracingRoot: monorepoRoot,
  transpilePackages: ['@estoicos/shared'],
  poweredByHeader: false,
  deploymentId: process.env.RAILWAY_GIT_COMMIT_SHA,
  async headers() {
    return [
      {
        // Nada de la app se cachea en Cloudflare: son páginas con sesión.
        source: '/:path*',
        headers: [
          { key: 'Cache-Control', value: 'private, no-store' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
