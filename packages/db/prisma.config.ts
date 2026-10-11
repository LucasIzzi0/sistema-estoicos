import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

// El .env vive en la raíz del monorepo. En Railway las variables ya vienen del entorno.
loadEnv({ path: fileURLToPath(new URL('../../.env', import.meta.url)), quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx src/seed/index.ts',
  },
  datasource: {
    url: process.env.DATABASE_URL,
    // Base descartable que usa Prisma para calcular migraciones nuevas (solo desarrollo).
    shadowDatabaseUrl: process.env.SHADOW_DATABASE_URL,
  },
});
